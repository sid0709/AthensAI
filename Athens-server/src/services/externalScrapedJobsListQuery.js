import { JobSourceTitles, inferJobSource } from '../config/jobSources.js';
import { buildMongoCaseInsensitiveRegexFilter } from '../utils/safeRegex.js';

function finalizeQuery(query) {
	if (query.$and?.length === 1) {
		Object.assign(query, query.$and[0]);
		delete query.$and;
	} else if (query.$and?.length === 0) {
		delete query.$and;
	}
	return query;
}

function buildSourceFilter(jobSources) {
	const jobSourceItem = (jobSources !== undefined ? String(jobSources).split(',') : JobSourceTitles)
		.map((s) => s.trim())
		.filter(Boolean);
	const knownSources = JobSourceTitles.filter((s) => s !== 'Other');
	const allSourcesSelected =
		jobSourceItem.includes('Other') && knownSources.every((s) => jobSourceItem.includes(s));

	if (allSourcesSelected) return null;

	const sourceMatchers = jobSourceItem
		.map((source) => buildMongoCaseInsensitiveRegexFilter(source, { exact: true }))
		.filter(Boolean);

	if (!sourceMatchers.length) return null;

	return {
		$or: sourceMatchers.map((matcher) => ({ source: matcher })),
	};
}

/**
 * Mongo filter for external_scraped_jobs from POST /jobs/list body.
 * Only maps filters external rows can satisfy (title, company, source).
 */
export function buildExternalScrapedJobsQuery(body = {}) {
	const { q, jobSources, aiExtracted, ...filters } = body;
	const query = { $and: [] };

	const titleFilter = buildMongoCaseInsensitiveRegexFilter(q);
	if (titleFilter) query.$and.push({ jobTitle: titleFilter });

	const companyName = filters['company.name'];
	if (typeof companyName === 'string' && companyName.trim()) {
		const companyFilter = buildMongoCaseInsensitiveRegexFilter(companyName);
		if (companyFilter) query.$and.push({ companyName: companyFilter });
	}

	const sourceFilter = buildSourceFilter(jobSources);
	if (sourceFilter) query.$and.push(sourceFilter);

	if (aiExtracted === true || aiExtracted === 'true') {
		query.$and.push({ aiSkillStatus: 'extracted' });
	}

	return finalizeQuery(query);
}

/** Normalize one external_scraped_jobs document to job_market list shape. */
export function normalizeExternalScrapedJob(doc) {
	if (!doc || typeof doc !== 'object') return doc;

	const applyLink = doc.applyLink || doc.jobLink || '#';
	const source =
		typeof doc.source === 'string' && doc.source.trim()
			? doc.source.trim()
			: inferJobSource(applyLink);

	const enrichedCompany =
		doc.company && typeof doc.company === 'object'
			? {
					name: doc.company.name || doc.companyName || 'Unknown',
					logo: doc.company.logo || doc.companyIcon || undefined,
					tags: Array.isArray(doc.company.tags) ? doc.company.tags : [],
				}
			: {
					name: doc.companyName || 'Unknown',
					logo: doc.companyIcon || undefined,
					tags: [],
				};

	const base = {
		_id: doc._id,
		catalog: 'external',
		title: doc.title || doc.jobTitle || 'Untitled role',
		company: enrichedCompany,
		details: doc.details && typeof doc.details === 'object' ? doc.details : {},
		applyLink,
		jobDescription: doc.jobDescription || '',
		description: doc.description || doc.jobDescription || '',
		source,
		postedAgo: typeof doc.postedAgo === 'string' ? doc.postedAgo : undefined,
		postedAt: doc.postedAt || doc.createdAt || doc.updatedAt || new Date(0).toISOString(),
	};

	const enrichedFields = {};
	for (const key of [
		'aiSkills',
		'skills',
		'skillsNormalized',
		'skillTokens',
		'aiSkillStatus',
		'aiSkillExtractedAt',
		'matchScoreStatus',
		'modelVersion',
	]) {
		if (doc[key] !== undefined) enrichedFields[key] = doc[key];
	}

	return { ...base, ...enrichedFields };
}

export function isIncludeExternalScraped(body = {}) {
	const flag = body.includeExternalScraped;
	return flag === true || flag === 'true';
}

function parseScoreBound(value) {
	if (value === undefined || value === null || value === '') return null;
	const n = Number(value);
	if (!Number.isFinite(n)) return null;
	return Math.max(0, Math.min(100, Math.round(n)));
}

/** External rows without match scores are excluded when score-dimension filters are active. */
export function hasBlockingFiltersForExternal(body = {}) {
	const dimensions = [
		['scoreOverallMin', 'scoreOverallMax'],
		['scoreSkillMin', 'scoreSkillMax'],
		['scoreSalaryMin', 'scoreSalaryMax'],
		['scoreBidEstMin', 'scoreBidEstMax'],
		['scoreFreshnessMin', 'scoreFreshnessMax'],
	];

	for (const [minKey, maxKey] of dimensions) {
		const min = parseScoreBound(body[minKey]);
		const max = parseScoreBound(body[maxKey]);
		if (min !== null && min > 0) return true;
		if (max !== null && max < 100) return true;
	}

	return false;
}

/** External jobs only appear on all/posted tabs (treated as new). */
export function externalAllowedForStatusTab(statusTab) {
	return statusTab === 'all' || statusTab === 'posted' || statusTab === 'new';
}

export function resolveStatusTabFromBody(body = {}) {
	if (body.applied === false || body.applied === 'false') return 'posted';
	if (body.applied === true || body.applied === 'true') {
		if (body.status === 'Scheduled') return 'scheduled';
		if (body.status === 'Declined') return 'declined';
		return 'applied';
	}
	return 'all';
}

export function shouldMergeExternal(body = {}, statusTab = resolveStatusTabFromBody(body)) {
	return (
		isIncludeExternalScraped(body) &&
		!hasBlockingFiltersForExternal(body) &&
		externalAllowedForStatusTab(statusTab)
	);
}
