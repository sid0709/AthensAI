import { accountInfoCollection } from '../db/mongo.js';
import { ObjectId } from 'mongodb';
import { excludeExtensionV2JobsFilter } from '../config/jobMarketSchema.js';
import { JobSourceTitles } from '../config/jobSources.js';
import { isBetaTier } from '../lib/betaTier.js';
import { buildMongoCaseInsensitiveRegexFilter, buildSafeRegExp } from '../utils/safeRegex.js';
import { searchJobIds } from './search/algoliaJobs.js';

const SCORE_DIMENSIONS = {
	overall: 'overallScore',
	skill: 'skillMatch',
};

function parseScoreBound(value) {
	if (value === undefined || value === null || value === '') return null;
	const n = Number(value);
	if (!Number.isFinite(n)) return null;
	return Math.max(0, Math.min(100, Math.round(n)));
}

export function extractScoreFilters(body) {
	const result = {};
	for (const [dim, scoreKey] of Object.entries(SCORE_DIMENSIONS)) {
		const cap = dim.charAt(0).toUpperCase() + dim.slice(1);
		const min = parseScoreBound(body[`score${cap}Min`]);
		const max = parseScoreBound(body[`score${cap}Max`]);
		if (min !== null || max !== null) {
			result[scoreKey] = { min, max };
		}
	}
	return result;
}

function applyStatusFilter(query, { appliedBool, status, applierId }) {
	if (appliedBool === false) {
		if (applierId) {
			query.$and.push({
				$or: [
					{ status: { $exists: false } },
					{ status: { $not: { $elemMatch: { applier: applierId } } } },
				],
			});
		} else {
			query.$and.push({ status: { $exists: false } });
		}
	} else if (appliedBool === true) {
		if (applierId) {
			if (status === 'Applied') {
				query.$and.push({
					status: {
						$elemMatch: {
							applier: applierId,
							appliedDate: { $exists: true },
							scheduledDate: { $exists: false },
							declinedDate: { $exists: false },
						},
					},
				});
			} else if (status === 'Scheduled') {
				query.$and.push({
					status: { $elemMatch: { applier: applierId, scheduledDate: { $exists: true } } },
				});
			} else if (status === 'Declined') {
				query.$and.push({
					status: { $elemMatch: { applier: applierId, declinedDate: { $exists: true } } },
				});
			} else if (status === 'BidReady') {
				query.$and.push({
					status: {
						$elemMatch: {
							applier: applierId,
							bidReadyDate: { $exists: true },
							bidCompletedDate: { $exists: false },
							appliedDate: { $exists: false },
							scheduledDate: { $exists: false },
							declinedDate: { $exists: false },
						},
					},
				});
			} else if (status === 'BidCompleted') {
				query.$and.push({
					status: {
						$elemMatch: {
							applier: applierId,
							bidCompletedDate: { $exists: true },
							appliedDate: { $exists: false },
							scheduledDate: { $exists: false },
							declinedDate: { $exists: false },
						},
					},
				});
			} else {
				query.$and.push({ status: { $elemMatch: { applier: applierId } } });
			}
		} else {
			query.$and.push({ status: { $exists: true } });
			if (status === 'Applied') {
				query.$and.push({
					status: {
						$elemMatch: {
							appliedDate: { $exists: true },
							scheduledDate: { $exists: false },
							declinedDate: { $exists: false },
						},
					},
				});
			} else if (status === 'Scheduled') {
				query.$and.push({ status: { $elemMatch: { scheduledDate: { $exists: true } } } });
			} else if (status === 'Declined') {
				query.$and.push({ status: { $elemMatch: { declinedDate: { $exists: true } } } });
			} else if (status === 'BidReady') {
				query.$and.push({
					status: {
						$elemMatch: {
							bidReadyDate: { $exists: true },
							bidCompletedDate: { $exists: false },
							appliedDate: { $exists: false },
							scheduledDate: { $exists: false },
							declinedDate: { $exists: false },
						},
					},
				});
			} else if (status === 'BidCompleted') {
				query.$and.push({
					status: {
						$elemMatch: {
							bidCompletedDate: { $exists: true },
							appliedDate: { $exists: false },
							scheduledDate: { $exists: false },
							declinedDate: { $exists: false },
						},
					},
				});
			}
		}
	}
}

function finalizeQuery(query) {
	if (query.$and.length === 1) {
		Object.assign(query, query.$and[0]);
		delete query.$and;
	} else if (query.$and.length === 0) {
		delete query.$and;
	}
	return query;
}

const APPLIER_CACHE_TTL_MS = 5 * 60 * 1000;
const applierCache = new Map();

/** Resolve applier Mongo id + beta tier (cached briefly). */
async function resolveApplierContext(applierName) {
	if (!applierName || !accountInfoCollection) {
		return { id: null, isBeta: false };
	}
	const name = String(applierName).trim();
	const cached = applierCache.get(name);
	if (cached && cached.expiresAt > Date.now()) {
		return { id: cached.id, isBeta: cached.isBeta };
	}

	const applierDoc = await accountInfoCollection.findOne({ name });
	const id = applierDoc?._id || null;
	const isBeta = Boolean(id) && isBetaTier(applierDoc?.tier);
	applierCache.set(name, { id, isBeta, expiresAt: Date.now() + APPLIER_CACHE_TTL_MS });
	return { id, isBeta };
}

const SCORE_FILTER_KEYS = new Set([
	'scoreOverallMin', 'scoreOverallMax',
	'scoreSkillMin', 'scoreSkillMax',
	'scoreSalaryMin', 'scoreSalaryMax',
	'scoreBidEstMin', 'scoreBidEstMax',
	'scoreFreshnessMin', 'scoreFreshnessMax',
]);

/**
 * Build a Mongo filter for POST /jobs/list from the request body.
 * Pass statusTab to override applied/status: all | posted | bid-ready | bid-completed | applied | scheduled | declined
 */
export async function buildJobsListQuery(body, { statusTab } = {}) {
	const {
		q,
		postedAtFrom,
		jobSources,
		postedAtTo,
		applied,
		status,
		applierName,
		sort: _sort,
		page: _page,
		limit: _limit,
		skip: _skip,
		countsOnly: _countsOnly,
		aiExtracted,
		titleScanned,
		version: _version,
		...filters
	} = body;

	const scoreFilters = extractScoreFilters(body);

	const { id: applierId, isBeta } = applierName
		? await resolveApplierContext(applierName)
		: { id: null, isBeta: false };

	const query = { $and: [] };

	// extension-v2 jobs (version=v2) are beta-tier only.
	if (!isBeta) {
		query.$and.push(excludeExtensionV2JobsFilter());
	}

	if (String(q || '').trim()) {
		const algoliaIds = await searchJobIds(q);
		if (algoliaIds) query.$and.push({ _id: { $in: algoliaIds.map((id) => new ObjectId(id)) } });
		else {
			const titleFilter = buildMongoCaseInsensitiveRegexFilter(q);
			if (titleFilter) query.$and.push({ title: titleFilter });
		}
	}

	// Show only jobs whose skills have been AI-extracted.
	if (aiExtracted === true || aiExtracted === 'true') {
		query.$and.push({ aiSkillStatus: 'extracted' });
	}

	// Multi-select AI title roles (comma-separated exact titleScanned values).
	if (titleScanned) {
		const roles = String(titleScanned)
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);
		if (roles.length === 1) {
			query.$and.push({ titleScanned: roles[0] });
		} else if (roles.length > 1) {
			query.$and.push({ titleScanned: { $in: roles } });
		}
	}

	for (const key in filters) {
		if (!Object.hasOwnProperty.call(filters, key)) continue;
		if (key.startsWith('$')) continue;
		if (SCORE_FILTER_KEYS.has(key)) continue;
		const value = filters[key];
		if (!value) continue;

		if (key === 'company.tags' && typeof value === 'string') {
			const tags = value.split(',').map((s) => s.trim()).filter(Boolean);
			if (tags.length) {
				const tagRegexes = tags.map((tag) => buildSafeRegExp(tag)).filter(Boolean);
				if (tagRegexes.length) {
					query.$and.push({ [key]: { $all: tagRegexes } });
				}
			}
		} else if (key === 'details.seniority' && typeof value === 'string') {
			const parts = value.split(',').map((s) => s.trim()).filter(Boolean);
			if (parts.length === 1) {
				const filter = buildMongoCaseInsensitiveRegexFilter(parts[0]);
				if (filter) query.$and.push({ [key]: filter });
			} else if (parts.length > 1) {
				const regexes = parts.map((part) => buildSafeRegExp(part)).filter(Boolean);
				if (regexes.length) {
					query.$and.push({ [key]: { $in: regexes } });
				}
			}
		} else if (key === 'details.remote' || key === 'details.time') {
			query.$and.push({ [key]: value });
		} else if (typeof value === 'string') {
			const filter = buildMongoCaseInsensitiveRegexFilter(value);
			if (filter) query.$and.push({ [key]: filter });
		}
	}

	const jobSourceItem = (jobSources !== undefined ? jobSources.split(',') : JobSourceTitles)
		.map((s) => s.trim())
		.filter(Boolean);
	const knownSources = JobSourceTitles.filter((s) => s !== 'Other');
	const allSourcesSelected =
		jobSourceItem.includes('Other') && knownSources.every((s) => jobSourceItem.includes(s));

	if (!allSourcesSelected) {
		query.$and.push({ source: { $in: jobSourceItem } });
	}

	let appliedBool =
		applied === true || applied === 'true'
			? true
			: applied === false || applied === 'false'
				? false
				: undefined;
	let statusFilter = status;

	if (statusTab) {
		if (statusTab === 'posted' || statusTab === 'new') {
			appliedBool = false;
			statusFilter = undefined;
		} else if (statusTab === 'applied') {
			appliedBool = true;
			statusFilter = 'Applied';
		} else if (statusTab === 'scheduled') {
			appliedBool = true;
			statusFilter = 'Scheduled';
		} else if (statusTab === 'declined') {
			appliedBool = true;
			statusFilter = 'Declined';
		} else if (statusTab === 'bid-ready') {
			appliedBool = true;
			statusFilter = 'BidReady';
		} else if (statusTab === 'bid-completed') {
			appliedBool = true;
			statusFilter = 'BidCompleted';
		} else {
			appliedBool = undefined;
			statusFilter = undefined;
		}
	}

	applyStatusFilter(query, { appliedBool, status: statusFilter, applierId });

	if (postedAtFrom || postedAtTo) {
		const postedAtQuery = {};
		if (postedAtFrom) postedAtQuery.$gte = postedAtFrom;
		if (postedAtTo) {
			const toDate = new Date(postedAtTo);
			toDate.setDate(toDate.getDate() + 1);
			postedAtQuery.$lt = toDate.toISOString().split('T')[0];
		}
		query.$and.push({ postedAt: postedAtQuery });
	}

	finalizeQuery(query);

	return { query, applierId, scoreFilters };
}

/** Status tab keys aligned with the Athens frontend. */
export const STATUS_TABS = ['all', 'posted', 'bid-ready', 'bid-completed', 'applied', 'scheduled', 'declined'];

/** Fields omitted from list responses to reduce payload size. */
export const JOB_LIST_PROJECTION = { description: 0, jobDescription: 0 };

/** Full job detail — omit only heavy embedding vectors. */
export const JOB_DETAIL_PROJECTION = { embedding: 0 };
