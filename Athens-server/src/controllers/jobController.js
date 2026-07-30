import { DocumentId } from "@nextoffer/shared/document-id";
import { mergeJobStatusRows, resolveJobStatusState } from "@nextoffer/shared/job-status";
import {
	jobsCollection,
	jobIdentityRegistryCollection,
	companiesCollection,
	companyAliasesCollection,
	externalScrapedJobsCollection,
	personalInfoCollection,
	companyCategoryCollection,
	accountInfoCollection,
	rulesCollection,
	getVendorTasksCollection,
} from "../db/dataStore.js";
import { isJobBlocked, buildQueryForRule, isMatchNoneQuery } from '../utils/ruleMatcher.js';
import { attachStaticScoreFields } from '../services/jobListPipeline.js';
import {
	JOB_MARKET_MODEL_VERSION,
	excludeExtensionV2JobsFilter,
	isExtensionV2Job,
	stripScraperOnlyJobFields,
} from '../config/jobMarketSchema.js';
import {
	classifyJobMarketIngest,
	duplicateJobResult,
	normalizeExtensionV2OriginalJob,
	resolveJobPostedAt,
	stampJobMarketIngestVersion,
	validateExtensionV2OriginalJob,
} from '../services/jobMarketIngest.js';
import { JobSourceTitles } from '../config/jobSources.js';
import { isBetaTier } from '../lib/betaTier.js';
import {
	buildJobsListQuery,
	STATUS_TABS,
	JOB_LIST_PROJECTION,
	JOB_DETAIL_PROJECTION,
	resolveApplierContext,
} from '../services/jobListQuery.js';
import { queueJobAnalysis, getJobAnalysisStatus } from '../services/jobAnalysis/index.js';
import { listRecommendedJobs } from '../services/matching/matchScoreReader.js';
import { normalizeExternalScrapedJob } from '../services/externalScrapedJobsListQuery.js';
import { listMergedJobs, countExternalForStatusTabs } from '../services/mergedJobsListService.js';
import { countIndexedJobStatuses, listIndexedJobPage } from '../services/matching/indexedJobListService.js';
import { normalizeJobSkills, jobSkillTokens, indexJobInRedis } from '../services/matching/skillIndex.js';
import { deleteScoresForJobs } from '../services/matching/matchScoreStore.js';
import { indexOneJobRanking, removeJobsFromRanking } from '../services/matching/jobRankingIndex.js';
import { buildJobSkillRadar } from '../services/jobSkillRadarService.js';
import {
	clearJobBidStatus,
	upsertJobBidStatus,
} from '../services/jobBidStatusService.js';
import { isForegroundBusy } from '../services/runtimeLoad.js';
import {
	invalidateLiveProjectedStatusCount,
	listMaterializedPostedPage,
	listMaterializedJobStatusPage,
	mutateJobStatus,
	mutateJobStatusesBulk,
} from '../services/jobStatusProjectionService.js';
import { findDuplicateByUrl } from '../services/jobDuplicateLookup.js';
import {
	claimJobIdentity,
	finalizeJobIdentityClaim,
	releaseJobIdentityClaim,
} from '../services/jobIdentityDedupe.js';
import { applyCompanyIdentity, resolveCompanyIdentity } from '../services/companyIdentity.js';
import {
	listCompanyGroupedJobs,
	listCompanyGroupMembers,
} from '../services/companyGroupedJobsService.js';
import {
	countJobsV2,
	getJobListReadModelState,
	listJobCompanyMembersV2,
	listJobsV2,
	patchJobListViewerStatus,
	evictJobsFromJobListReadModel,
	listCompanyJobIdsFromReadModel,
} from '../services/jobListReadModelService.js';
import {
	deleteJobDocuments,
	findOtherCompanyJobIds,
	normalizeCompanySiblingRemoval,
	normalizeJobRemovalIds,
} from '../services/jobRemovalService.js';
import { setGauge } from '../services/monitoring/metrics.js';
import { ingestJobsBulk, MAX_JOB_BULK_SIZE } from '../services/jobBulkIngest.js';
import {
	patchTitleReviewReadModel,
} from '../services/jobTitleReview/titleReviewReadModel.js';
import { mapTitleReviewDocument } from '../services/jobTitleReview/titleReviewQueryService.js';

const DUPLICATE_LOOKBACK_DAYS = 30;
const LOOKBACK_WINDOW_MS = DUPLICATE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
const JOB_COUNT_CACHE_MS = Number(process.env.JOB_COUNT_CACHE_MS || 5 * 60 * 1000);
const jobCountCache = new Map();

export function invalidateJobListCountCache() {
	jobCountCache.clear();
}
const jobCountRefreshes = new Map();

function jobForProfile(job, profileId) {
	if (!job || !profileId) return { ...job, status: [] };
	const row = mergeJobStatusRows(job.status, String(profileId));
	if (!row) return { ...job, status: [] };
	const canonical = { applier: String(profileId) };
	for (const field of ['appliedDate', 'scheduledDate', 'declinedDate', 'bidReadyDate', 'bidCompletedDate']) {
		if (!row[field]) continue;
		const raw = row[field];
		const date = raw instanceof Date ? raw : typeof raw?.toDate === 'function' ? raw.toDate() : new Date(raw);
		canonical[field] = Number.isNaN(date.getTime()) ? String(raw) : date.toISOString();
	}
	return { ...job, status: [canonical] };
}

async function jobsForApplier(jobs, applierName) {
	const name = String(applierName || '').trim();
	const account = name ? await resolveApplierContext(name) : null;
	const profileId = account?.id ? String(account.id) : null;
	return (Array.isArray(jobs) ? jobs : []).map((job) => jobForProfile(job, profileId));
}

function syncMutationReadModel(result, jobId) {
	patchJobListViewerStatus({
		profileId: result.profileId,
		jobId,
		state: result.viewerStatus,
		version: result.statusVersion,
	});
}

function mutationMetadata(result) {
	return {
		changed: Boolean(result.changed),
		mutationId: result.mutationId,
		statusVersion: result.statusVersion,
		cacheSync: result.cacheSync || 'queued',
		viewerStatus: result.viewerStatus,
	};
}

function jobCountCacheKey(body = {}) {
	return JSON.stringify(Object.fromEntries(Object.entries(body).sort(([left], [right]) => left.localeCompare(right))));
}

async function materializedCountsForRequest() {
	// Legacy status baselines include quarantined title-review jobs. Use the exact
	// review-aware read model until those baselines carry the visibility facet.
	return null;
}

async function calculateJobStatusCounts(body) {
	const facet = {};
	for (const tab of STATUS_TABS) {
		const { query } = await buildJobsListQuery(body, { statusTab: tab });
		facet[tab] = [{ $match: query }, { $count: 'count' }];
	}
	const [result] = await jobsCollection.aggregate([{ $facet: facet }]).toArray();
	const counts = {};
	for (const tab of STATUS_TABS) counts[tab] = result?.[tab]?.[0]?.count ?? 0;
	const externalCounts = await countExternalForStatusTabs(body);
	counts.all += externalCounts.all;
	counts.posted += externalCounts.posted;
	return counts;
}

function refreshJobStatusCountsWhenIdle(key, body) {
	if (jobCountRefreshes.has(key)) return;
	const refresh = new Promise((resolve) => {
		const attempt = async () => {
			if (isForegroundBusy()) {
				setTimeout(attempt, 10_000).unref?.();
				return;
			}
			try {
				const counts = await calculateJobStatusCounts(body);
				jobCountCache.set(key, { counts, expiresAt: Date.now() + JOB_COUNT_CACHE_MS });
			} catch (error) {
				console.warn('[jobs] deferred status count refresh failed:', error?.message || error);
			} finally {
				jobCountRefreshes.delete(key);
				resolve();
			}
		};
		setTimeout(attempt, 10_000).unref?.();
	});
	jobCountRefreshes.set(key, refresh);
}

const toValidDate = (value) => {
	if (!value) return null;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
};

const extractJobTimestamp = (jobDoc) => {
	return toValidDate(jobDoc?.postedAt) || toValidDate(jobDoc?._createdAt) || toValidDate(jobDoc?.createdAt);
};

/** True when existing job is within the 30-day duplicate window of the incoming postedAt. */
const isWithinDuplicateWindow = (existingJob, newPostedAt) => {
	const existingTimestamp = extractJobTimestamp(existingJob);
	const newJobTimestamp = toValidDate(newPostedAt);
	return (
		!existingTimestamp ||
		!newJobTimestamp ||
		newJobTimestamp.getTime() - existingTimestamp.getTime() < LOOKBACK_WINDOW_MS
	);
};

export async function createJob(req, res) {
	let identityClaim = null;
	let jobInserted = false;
	try {
		let job = req.body;
		if (!job) return res.status(400).json({ error: 'Missing job in request body' });

		const clientHeader = typeof req.get === 'function' ? req.get('x-athens-client') : '';
		const ingest = classifyJobMarketIngest(job, clientHeader);
		if (ingest.kind === 'extension-v2-original') {
			job = normalizeExtensionV2OriginalJob(job);
			const validation = validateExtensionV2OriginalJob(job);
			if (!validation.valid) {
				return res.status(422).json({
					success: false,
					created: false,
					code: 'INVALID_EXTENSION_V2_JOB',
					error: validation.error,
					reason: validation.error,
				});
			}
		}

		// Requirement 2: if title is empty(""), not create.
		const title = typeof job.title === 'string' ? job.title.trim() : '';
		if (!title) {
			return res.status(400).json({ error: 'Job title cannot be empty' });
		}
		job.title = title;

		// Check if the job is blocked by any rule
		const blockingRule = await isJobBlocked(job);
		if (blockingRule) {
			console.log(`Job "${job.title}" from "${job.company?.name}" blocked by rule: "${blockingRule}"`);
			return res.status(200).json({ success: false, created: false, reason: `Blocked by rule: ${blockingRule}` });
		}

		const now = new Date();
		const createdAt = now.toISOString();
		const postedAt = resolveJobPostedAt(job, now);

		const fromExtensionV2 = ingest.fromExtensionV2;
		const identitySource = fromExtensionV2 ? 'extension-v2' : 'extension';
		// Preserve the legacy URL scope. Company/title identity dedupe below is
		// intentionally global across Extension, extension-v2, and exposed jobs.
		const duplicateScope = fromExtensionV2 ? {} : excludeExtensionV2JobsFilter();

		// Existing URL protection remains additive to company/title identity dedupe.
		const urlCandidates = [
			...new Set(
				[job.applyLink, job.url]
					.filter((u) => typeof u === 'string' && u.trim())
					.map((u) => u.trim()),
			),
		];
		if (urlCandidates.length) {
			const existingByUrl = await findDuplicateByUrl(jobsCollection, urlCandidates, duplicateScope);
			if (existingByUrl && isWithinDuplicateWindow(existingByUrl, postedAt)) {
				return res.status(200).json(duplicateJobResult({
					existingId: existingByUrl._id,
					reason: 'Job with this URL has been posted within the last 30 days',
				}));
			}
		}

		const companyName = typeof job.company?.name === 'string' ? job.company.name.trim() : '';
		const description = typeof job.description === 'string' ? job.description.trim() : '';
		identityClaim = await claimJobIdentity(jobIdentityRegistryCollection, {
			companyName,
			title,
			acceptedAt: now,
			source: identitySource,
		});
		if (identityClaim.duplicate) {
			return res.status(200).json(duplicateJobResult({
				existingId: identityClaim.existingJobId ? String(identityClaim.existingJobId) : '',
				reason: 'Duplicate job with this company and title was added within the last 30 days',
			}));
		}

		stripScraperOnlyJobFields(job);

		// Persist trimmed content fields so future content-dedupe lookups stay consistent.
		job.description = description;
		if (job.company && typeof job.company === 'object') {
			job.company.name = companyName;
		}
		const companyIdentity = await resolveCompanyIdentity(job, {
			companiesCollection,
			companyAliasesCollection,
			seed: job.id || job.applyLink || job.url,
		});
		applyCompanyIdentity(job, companyIdentity);
		if (companyIdentity.companyIdentityConflict) {
			console.warn('[company-identity] conflicting aliases; trusted domain selected', {
				companyId: companyIdentity.companyId,
				company: companyName,
			});
		}

		// Never trust arbitrary client versions — only stamp classified extension-v2.
		stampJobMarketIngestVersion(job, ingest);

		job._createdAt = createdAt;
		job.postedAt = postedAt;
		job.modelVersion = JOB_MARKET_MODEL_VERSION;
		// Company page URL scraped by the extension; normalize to a trimmed string
		// (default "") so the field is always present and consistent in storage.
		job.companyLink = typeof job.companyLink === 'string' ? job.companyLink.trim() : '';

		const skills = Array.isArray(job.skills) ? job.skills.map(s => String(s).trim()).filter(Boolean) : [];
		job.skillsNormalized = normalizeJobSkills(skills);
		job.skillTokens = jobSkillTokens(skills);
		try {
			const companyTags = Array.isArray(job.company?.tags) ? job.company.tags.map(t => String(t).trim()).filter(Boolean) : [];
			if (companyCategoryCollection && companyTags.length) {
				const ops = companyTags.map(tag => ({
					updateOne: {
						filter: { name: tag },
						update: { $setOnInsert: { name: tag, createdAt: new Date().toISOString() } },
						upsert: true,
					}
				}));
				await companyCategoryCollection.bulkWrite(ops, { ordered: false });
			}
		} catch (e) {
			console.warn('Failed to upsert company categories', e);
		}

		// Match-score worker fans this job out to every user profile.
		job.matchScoreStatus = 'pending';
		// Queue for AI skill extraction (run manually from the Extract skills button).
		job.aiSkillStatus = 'pending';
		// A queryable state keeps the title-review queue indexed. Missing-field
		// checks force Firestore to scan the entire catalog.
		job.titleReview = { processingState: 'pending' };
		Object.assign(job, attachStaticScoreFields({ ...job, skills }));
		// Re-assert after static fields — distinct from sourceVersion / modelVersion.
		stampJobMarketIngestVersion(job, ingest);

		const result = jobsCollection ? await jobsCollection.insertOne(job) : null;
		jobInserted = Boolean(result?.insertedId);

		if (result?.insertedId) {
			await finalizeJobIdentityClaim(jobIdentityRegistryCollection, identityClaim, {
				jobId: result.insertedId,
				source: identitySource,
			}).catch((error) => {
				// The acceptedAt claim itself already blocks duplicates; final metadata
				// is best-effort and must not turn a successful insert into a 500.
				console.warn('[job-identity] finalize failed:', error?.message || error);
			});
			void indexJobInRedis(String(result.insertedId), job.skillsNormalized, job.skillTokens).catch(() => {});
			void indexOneJobRanking({ ...job, _id: result.insertedId }).catch(() => {});
			if (!req.deferTitleReviewRevision) {
				void patchTitleReviewReadModel({
					upsertRows: [mapTitleReviewDocument({ ...job, _id: result.insertedId })],
				}).catch((error) => {
					console.warn('[title-review] new-job snapshot patch failed:', error?.message || error);
				});
			}
		}

		return res.status(201).json({
			success: true,
			created: true,
			insertedId: result ? result.insertedId : null,
		});
	} catch (err) {
		if (identityClaim?.claimed && !jobInserted) {
			await releaseJobIdentityClaim(jobIdentityRegistryCollection, identityClaim).catch((releaseError) => {
				console.warn('[job-identity] release after failed /jobs insert failed:', releaseError?.message || releaseError);
			});
		}
		console.error('POST /api/jobs error', err);
		return res.status(500).json({ success: false, error: err.message });
	}
}

export async function createJobsBulk(req, res) {
	const jobs = Array.isArray(req.body?.jobs) ? req.body.jobs : null;
	if (!jobs) {
		return res.status(400).json({ success: false, error: 'Request body must contain a jobs array' });
	}
	if (jobs.length === 0) {
		return res.status(400).json({ success: false, error: 'At least one job is required' });
	}
	if (jobs.length > MAX_JOB_BULK_SIZE) {
		return res.status(400).json({
			success: false,
			error: `A bulk request may contain at most ${MAX_JOB_BULK_SIZE} jobs`,
		});
	}

	const client = typeof req.get === 'function' ? req.get('x-athens-client') : '';
	const { results, summary } = await ingestJobsBulk(
		jobs,
		(job) => createJobRecord(job, { client, deferTitleReviewRevision: true }),
	);
	if (summary.created > 0 && jobsCollection) {
		const ids = results.filter((result) => result.created && result.insertedId).map((result) => String(result.insertedId));
		if (ids.length) {
			try {
				const createdJobs = await jobsCollection.find(
					{ _id: { $in: ids } },
					{ projection: {
						title: 1,
						company: 1,
						companyName: 1,
						source: 1,
						postedAt: 1,
						_createdAt: 1,
						applyLink: 1,
						jobLink: 1,
						titleReview: 1,
					} },
				).toArray();
				await patchTitleReviewReadModel({ upsertRows: createdJobs.map(mapTitleReviewDocument) });
			} catch (error) {
				console.warn('[title-review] bulk new-job snapshot patch failed:', error?.message || error);
			}
		}
	}
	return res.status(200).json({ success: true, results, summary });
}

/** Reuse the canonical ingest path from internal controllers without an HTTP loopback. */
export async function createJobRecord(job, { client = 'agent-manual', deferTitleReviewRevision = false } = {}) {
	let statusCode = 200;
	let payload = null;
	const response = {
		status(code) {
			statusCode = code;
			return this;
		},
		json(value) {
			payload = value;
			return value;
		},
	};
	await createJob({ body: job, get: () => client, deferTitleReviewRevision }, response);
	return { statusCode, payload: payload || {} };
}

export async function getJobsForRule(req, res) {
	try {
		const { name } = req.params;
		if (!name) {
			return res.status(400).json({ error: 'Rule name is required' });
		}

		const ruleSet = await rulesCollection.findOne({ name });
		if (!ruleSet) {
			return res.status(404).json({ error: 'Rule not found' });
		}

		const query = buildQueryForRule(ruleSet);

		// A query that finds nothing
		if (isMatchNoneQuery(query)) {
			return res.json({
				success: true,
				data: [],
				message: "Search for this rule is not supported due to its complexity (e.g., mixed logical operators or XOR)."
			});
		}

		const account = req.query?.applierName
			? await resolveApplierContext(String(req.query.applierName).trim())
			: null;
		const titleReviewVisibility = { 'titleReview.label': 'APPROVED' };
		const visibleQuery = account?.isBeta
			? { $and: [query, titleReviewVisibility] }
			: { $and: [query, titleReviewVisibility, excludeExtensionV2JobsFilter()] };
		const jobs = await jobsCollection.find(visibleQuery).limit(100).toArray(); // Limit to 100 results for now
		const responseJobs = await jobsForApplier(jobs, req.query?.applierName);

		res.status(200).json({ success: true, data: responseJobs });

	} catch (err) {
		console.error(`GET /api/jobs/rule/${req.params.name} error`, err);
		return res.status(500).json({ success: false, error: err.message });
	}
}

export async function removeJobsForRule(req, res) {
	try {
		if (!jobsCollection) {
			return res.status(503).json({ success: false, error: 'Database not ready' });
		}

		const { name } = req.params;
		if (!name) {
			return res.status(400).json({ success: false, error: 'Rule name is required' });
		}

		const ruleSet = await rulesCollection.findOne({ name });
		if (!ruleSet) {
			return res.status(404).json({ success: false, error: 'Rule not found' });
		}

		const query = buildQueryForRule(ruleSet);
		if (isMatchNoneQuery(query)) {
			return res.status(400).json({
				success: false,
				error: 'Cannot remove jobs for this rule due to unsupported logic (e.g., mixed operators or XOR).',
			});
		}

		const doomed = await jobsCollection.find(query, { projection: { _id: 1 } }).toArray();
		const result = await jobsCollection.deleteMany(query);
		invalidateLiveProjectedStatusCount();
		void deleteScoresForJobs(doomed.map((d) => d._id)).catch(() => {});
		void removeJobsFromRanking(doomed.map((d) => d._id)).catch(() => {});
		return res.json({ success: true, deletedCount: result.deletedCount });
	} catch (err) {
		console.error(`DELETE /api/jobs/rule/${req.params.name} error`, err);
		return res.status(500).json({ success: false, error: err.message });
	}
}

/**
 * Status counts are expensive in Firestore because the legacy per-user status
 * values live inside an array. Never let that compatibility scan block the job
 * list: return a fast indexed catalog count and refresh exact tab counts only
 * after interactive traffic has gone quiet.
 */
export async function getJobStatusCounts(req, res) {
	try {
		if (!jobsCollection) {
			return res.status(503).json({ success: false, error: 'Database not ready' });
		}

		const materialized = await materializedCountsForRequest(req.body);
		if (materialized) return res.json({ success: true, counts: materialized, materialized: true });
		const indexed = await countIndexedJobStatuses(req.body);
		if (indexed) return res.json({ success: true, counts: indexed, indexed: true });

		const key = jobCountCacheKey(req.body);
		const cached = jobCountCache.get(key);
		if (cached) {
			if (cached.expiresAt <= Date.now()) refreshJobStatusCountsWhenIdle(key, { ...req.body });
			return res.json({ success: true, counts: cached.counts, cached: true });
		}

		const [{ query: allQuery }, externalCounts] = await Promise.all([
			buildJobsListQuery(req.body, { statusTab: 'all' }),
			countExternalForStatusTabs(req.body),
		]);
		const marketTotal = await jobsCollection.countDocuments(allQuery);
		const all = marketTotal + externalCounts.all;
		const counts = Object.fromEntries(STATUS_TABS.map((tab) => [tab, 0]));
		counts.all = all;
		// Until exact array counts are warmed, treating the catalog as posted is
		// preferable to hiding jobs or blocking the first paint.
		counts.posted = all;
		jobCountCache.set(key, { counts, expiresAt: 0 });
		refreshJobStatusCountsWhenIdle(key, { ...req.body });
		return res.json({ success: true, counts, cached: false, warming: true });
	} catch (err) {
		console.error('POST /api/jobs/list/counts error', err);
		return res.status(500).json({ success: false, error: err.message });
	}
}

export async function getJobs(req, res) {
	try {
		if (!jobsCollection) {
			return res.status(503).json({ success: false, error: 'Database not ready' });
		}
		if (req.body.groupBy === 'company' || req.body.groupByCompany === true) {
			const grouped = await listCompanyGroupedJobs(req.body);
			if (grouped?.unavailable) {
				return res.status(503).json({ success: false, error: 'Grouped Job Search is temporarily unavailable' });
			}
			if (!grouped?.disabled) return res.json(grouped);
		}
		// Status tabs are refreshed by the dedicated /jobs/list/counts request.
		// Never hold job cards behind a separate Firestore count read.
		const statusCounts = null;

		const requestedSort = String(req.body.sort || 'postedAt_desc');
		const canUseMaterializedPostedPage = requestedSort === 'postedAt_desc' || requestedSort === 'postedAt_asc';
		const indexedJobPage = requestedSort === 'recommended' ? null : await listIndexedJobPage(req.body);
		const materializedStatusPage = indexedJobPage || await listMaterializedJobStatusPage(req.body)
			|| (canUseMaterializedPostedPage ? await listMaterializedPostedPage(req.body) : null);
		if (materializedStatusPage) {
			const recommendedRequested = req.body.sort === 'recommended';
			const responseDocs = await jobsForApplier(materializedStatusPage.docs, req.body.applierName);
			return res.json({
				success: true,
				data: responseDocs,
				statusCounts,
				recommendationFallback: recommendedRequested,
				recommendationReason: recommendedRequested ? 'status_date_order' : null,
				recommendationWarming: false,
				catalogTotal: materializedStatusPage.total,
				pagination: {
					total: materializedStatusPage.total,
					page: materializedStatusPage.page,
					limit: materializedStatusPage.limit,
					totalPages: Math.ceil(materializedStatusPage.total / materializedStatusPage.limit),
				},
			});
		}

		const mergedResult = await listMergedJobs(req.body);
		if (mergedResult.mergeExternal) {
			const { docs, total, pageNum, limitNum, recommendationFallback, recommendationReason, recommendationWarming, catalogTotal } = mergedResult;
			const responseDocs = await jobsForApplier(docs, req.body.applierName);
			return res.json({
				success: true,
				data: responseDocs,
				statusCounts,
				recommendationFallback,
				recommendationReason,
				recommendationWarming,
				catalogTotal,
				rankingVersion: mergedResult.rankingVersion ?? null,
				rankingStatus: mergedResult.rankingStatus ?? (recommendationFallback ? 'fallback' : 'legacy'),
				catalogRevision: mergedResult.catalogRevision ?? null,
				personalizedThroughRank: mergedResult.personalizedThroughRank ?? null,
				pagination: {
					total,
					page: pageNum,
					limit: limitNum,
					totalPages: Math.ceil(total / limitNum),
				},
			});
		}

		const {
			sort,
			applierName,
		} = req.body;
		const {
			marketQuery: query,
			applierId,
			scoreFilters,
			skip,
			limit: limitNum,
			pageNum,
			countsOnly,
		} = mergedResult;

		if (countsOnly === true || countsOnly === 'true') {
			const total = await jobsCollection.countDocuments(query);
			return res.json({
				success: true,
				data: [],
				pagination: {
					total,
					page: pageNum,
					limit: limitNum,
					totalPages: Math.ceil(total / limitNum),
				},
			});
		}

		let docs;
		let total;
		let recommendationFallback = false;
		let recommendationReason = null;
		let recommendationWarming = false;
		let catalogTotal = null;
		let rankingVersion = null;
		let rankingStatus = null;
		let catalogRevision = null;
		let personalizedThroughRank = null;
		const useRecommendation = sort === 'recommended' && applierName;

		if (useRecommendation) {
			// Start the lightweight date page alongside personalization. It is
			// discarded when Best Match wins, but makes cold/no-skills fallback
			// latency the max of the two reads instead of their sum.
			const indexedFallbackPage = listIndexedJobPage({ ...req.body, sort: 'postedAt_desc' })
				.catch((error) => {
					console.warn('[jobs] indexed recommendation fallback failed:', error?.message || error);
					return null;
				});
			const result = await listRecommendedJobs({
				applierName,
				profileId: applierId ? String(applierId) : null,
				dataQuery: query,
				scoreFilters,
				listBody: req.body,
				skip,
				limit: limitNum,
				fastFallback: async () => {
					const page = await indexedFallbackPage;
					if (!page) return null;
					return {
						docs: page.docs,
						total: page.total,
						catalogTotal: page.total,
						recommendationFallback: true,
						recommendationReason: 'ranking_backend_unavailable',
						recommendationWarming: false,
						recommendationMaterialized: false,
						rankingVersion: null,
						rankingStatus: 'fallback',
						catalogRevision: null,
						personalizedThroughRank: 0,
					};
				},
			});
			docs = result.docs || [];
			total = result.total ?? docs.length;
			catalogTotal = result.catalogTotal ?? total;
			recommendationFallback = Boolean(result.recommendationFallback);
			recommendationReason = recommendationFallback
				? result.recommendationReason || result.reason || 'unknown'
				: null;
			recommendationWarming = Boolean(result.recommendationWarming);
			rankingVersion = result.rankingVersion ?? null;
			rankingStatus = result.rankingStatus ?? (
				recommendationFallback ? 'fallback' : recommendationWarming ? 'warming' : 'legacy'
			);
			catalogRevision = result.catalogRevision ?? null;
			personalizedThroughRank = result.personalizedThroughRank ?? null;
		} else {
			const sortOption = {};
			if (sort && typeof sort === 'string') {
				let sortField = '', sortOrder;
				[sortField, sortOrder] = sort.split('_');
				if (sortField === 'postedAt') {
					sortOption.postedAt = sortOrder === 'asc' ? 1 : -1;
				} else if (sortField && sortField.trim().length > 0) {
					sortOption[sortField] = sortOrder === 'desc' ? -1 : 1;
				} else {
					sortOption.postedAt = -1;
				}
			} else {
				sortOption.postedAt = -1;
			}
			[docs, total] = await Promise.all([
				jobsCollection
					.find(query, { projection: JOB_LIST_PROJECTION })
					.sort(sortOption)
					.skip(skip)
					.limit(limitNum)
					.toArray(),
				jobsCollection.countDocuments(query),
			]);
		}

		const responseDocs = await jobsForApplier(docs, applierName);
		return res.json({
			success: true,
			data: responseDocs,
			statusCounts,
			recommendationFallback,
			recommendationReason,
			recommendationWarming,
			catalogTotal,
			rankingVersion,
			rankingStatus: rankingStatus ?? (recommendationFallback ? 'fallback' : null),
			catalogRevision,
			personalizedThroughRank,
			pagination: {
				total,
				page: pageNum,
				limit: limitNum,
				totalPages: Math.ceil(total / limitNum),
			}
		});

	} catch (err) {
		console.error('GET /api/jobs error', err);
		return res.status(500).json({ success: false, error: err.message });
	}
}

/** Compact, pre-materialized Job Search endpoint. */
export async function getJobsV2(req, res) {
	const started = performance.now();
	try {
		const result = await listJobsV2(req.body || {});
		if (result?.disabled) return res.status(404).json({ success: false, error: 'Job Search v2 is disabled' });
		const totalMs = performance.now() - started;
		const phases = result._serverTiming || { total: totalMs };
		res.setHeader('Server-Timing', Object.entries(phases)
			.map(([phase, duration]) => `jobs-v2-${phase};dur=${Number(duration).toFixed(1)}`)
			.join(', '));
		setGauge(
			'athens_jobs_v2_payload_bytes',
			{ limit: String(result.pagination?.limit || 0) },
			Buffer.byteLength(JSON.stringify(result)),
		);
		res.setHeader('X-Job-Read-Model-Version', String(result.readModelVersion || ''));
		return res.json(result);
	} catch (err) {
		console.error('POST /api/jobs/list/v2 error', err);
		return res.status(503).json({
			success: false,
			retryable: true,
			error: err.message,
			readModel: getJobListReadModelState(),
		});
	}
}

/** Snapshot-backed status counts; intentionally independent from card delivery. */
export async function getJobStatusCountsV2(req, res) {
	const started = performance.now();
	try {
		const result = await countJobsV2(req.body || {});
		if (result?.disabled) return res.status(404).json({ success: false, error: 'Job Search v2 is disabled' });
		res.setHeader('Server-Timing', `jobs-v2-counts;dur=${(performance.now() - started).toFixed(1)}`);
		return res.json(result);
	} catch (err) {
		console.error('POST /api/jobs/list/v2/counts error', err);
		return res.status(503).json({ success: false, retryable: true, error: err.message });
	}
}

export async function getCompanyGroupMembersV2(req, res) {
	try {
		const result = await listJobCompanyMembersV2(req.body || {});
		if (result?.disabled) return res.status(404).json({ success: false, error: 'Job Search v2 is disabled' });
		if (result?.invalid) return res.status(400).json({ success: false, error: result.error || 'Invalid request' });
		if (result?.notFound) return res.status(404).json({ success: false, error: 'Company group not found' });
		res.setHeader('X-Job-Read-Model-Version', String(result.readModelVersion || ''));
		return res.json(result);
	} catch (err) {
		console.error('POST /api/jobs/list/v2/company-members error', err);
		return res.status(503).json({ success: false, retryable: true, error: err.message });
	}
}

export async function getCompanyGroupMembers(req, res) {
	try {
		if (!jobsCollection) return res.status(503).json({ success: false, error: 'Database not ready' });
		const result = await listCompanyGroupMembers(req.body || {});
		if (result?.disabled) return res.status(404).json({ success: false, error: 'Company grouping is disabled' });
		if (result?.unavailable) return res.status(503).json({ success: false, error: 'Grouped Job Search is temporarily unavailable' });
		if (result?.forbidden) return res.status(403).json({ success: false, error: 'Beta tier required', betaRequired: true });
		if (result?.notFound) return res.status(404).json({ success: false, error: 'Company group not found' });
		return res.json(result);
	} catch (err) {
		console.error('POST /api/jobs/list/company-members error', err);
		return res.status(500).json({ success: false, error: err.message });
	}
}

export async function applyToJob(req, res) {
	try {
		if (!jobsCollection) return res.status(503).json({ success: false, error: 'Database not ready' });
		const { id } = req.params;
		const { applierName, catalog, mutationId } = req.body;
		const result = await mutateJobStatus({ jobId: id, applierName, transition: 'apply', catalog, mutationId });
		syncMutationReadModel(result, id);
		jobCountCache.clear();
		return res.json({
			success: true,
			data: jobForProfile(result.job, result.profileId),
			...mutationMetadata(result),
			...(result.changed ? {} : { message: 'User has already applied' }),
		});
	} catch (err) {
		console.error('POST /api/jobs/:id/apply error', err);
		const status = err.message === 'Invalid job id' || err.message === 'applierName is required'
			? 400
			: err.message === 'Job not found' || /^User .+ not found$/.test(err.message) ? 404 : 500;
		return res.status(status).json({ success: false, error: err.message });
	}
}

export async function updateJobStatus(req, res) {
	try {
		if (!jobsCollection) return res.status(503).json({ success: false, error: 'Database not ready' });
		const { id } = req.params;
		const { status, applierName, catalog, mutationId } = req.body;
		const transition = ({ Declined: 'declined', Scheduled: 'scheduled', Applied: 'applied' })[status];
		if (!transition) {
			return res.status(400).json({ success: false, error: 'Invalid status' });
		}
		const result = await mutateJobStatus({ jobId: id, applierName, transition, catalog, mutationId });
		syncMutationReadModel(result, id);
		jobCountCache.clear();
		return res.json({ success: true, data: jobForProfile(result.job, result.profileId), ...mutationMetadata(result) });
	} catch (err) {
		console.error('POST /api/jobs/:id/status error', err);
		const statusCode = err.message === 'Invalid job id' || err.message === 'applierName is required'
			? 400
			: err.message === 'Job not found' || /^User .+ not found$/.test(err.message) ? 404 : 500;
		return res.status(statusCode).json({ success: false, error: err.message });
	}
}

export async function removeJobs(req, res) {
	try {
		if (!jobsCollection) return res.status(503).json({ success: false, error: 'Database not ready' });
		const ids = normalizeJobRemovalIds(req.body);
		if (!ids.length) return res.status(400).json({ success: false, error: 'Missing ids array' });

		const { deletedCount } = await deleteJobDocuments({ ids, jobsCollection });
		evictJobsFromJobListReadModel(ids);
		await patchTitleReviewReadModel({ deletedIds: ids });
		invalidateLiveProjectedStatusCount();
		jobCountCache.clear();
		void deleteScoresForJobs(ids).catch(() => {});
		void removeJobsFromRanking(ids).catch(() => {});
		return res.json({ success: true, deletedCount });
	} catch (err) {
		console.error('POST /api/jobs/remove error', err);
		return res.status(500).json({ success: false, error: err.message });
	}
}

export async function removeOtherCompanyJobs(req, res) {
	try {
		if (!jobsCollection) return res.status(503).json({ success: false, error: 'Database not ready' });
		const input = normalizeCompanySiblingRemoval(req.body);
		if (!input) {
			return res.status(400).json({ success: false, error: 'companyId and keepJobId are required' });
		}

		const companyJobIds = await listCompanyJobIdsFromReadModel(input.companyId);
		const ids = await findOtherCompanyJobIds({ ...input, jobsCollection, companyJobIds });
		if (!ids.length) return res.json({ success: true, deletedCount: 0, deletedIds: [] });

		const { deletedCount } = await deleteJobDocuments({ ids, jobsCollection });
		evictJobsFromJobListReadModel(ids);
		await patchTitleReviewReadModel({ deletedIds: ids });
		invalidateLiveProjectedStatusCount();
		jobCountCache.clear();
		void deleteScoresForJobs(ids).catch(() => {});
		void removeJobsFromRanking(ids).catch(() => {});
		return res.json({ success: true, deletedCount, deletedIds: ids });
	} catch (err) {
		console.error('POST /api/jobs/company/remove-others error', err);
		const status = err?.code === 'COMPANY_GROUP_CHANGED' ? 409 : 500;
		return res.status(status).json({ success: false, error: err.message });
	}
}

export async function unapplyFromJob(req, res) {
	try {
		if (!jobsCollection) return res.status(503).json({ success: false, error: 'Database not ready' });
		const { id } = req.params;
		const { applierName, catalog, mutationId } = req.body;
		const result = await mutateJobStatus({ jobId: id, applierName, transition: 'unapply', catalog, mutationId });
		syncMutationReadModel(result, id);
		jobCountCache.clear();
		return res.json({ success: true, data: jobForProfile(result.job, result.profileId), ...mutationMetadata(result) });
	} catch (err) {
		console.error('POST /api/jobs/:id/unapply error', err);
		const status = err.message === 'Invalid job id' || err.message === 'applierName is required'
			? 400
			: err.message === 'Job not found' || /^User .+ not found$/.test(err.message) ? 404 : 500;
		return res.status(status).json({ success: false, error: err.message });
	}
}

/**
 * POST /jobs/:id/bid-status
 * body: { applierName, status: 'BidReady' | 'BidCompleted' | 'clear' }
 */
export async function updateJobBidStatus(req, res) {
	try {
		if (!jobsCollection) return res.status(503).json({ success: false, error: 'Database not ready' });
		const { id } = req.params;
		const applierName = String(req.body?.applierName ?? '').trim();
		const status = String(req.body?.status ?? '').trim();
		const catalog = String(req.body?.catalog ?? 'market').trim();
		const mutationId = req.body?.mutationId ?? null;

		if (!applierName) {
			return res.status(400).json({ success: false, error: 'applierName is required' });
		}
		if (!['BidReady', 'BidCompleted', 'clear'].includes(status)) {
			return res.status(400).json({ success: false, error: 'status must be BidReady, BidCompleted, or clear' });
		}

		let documentId;
		try {
			documentId = new DocumentId(id);
		} catch {
			return res.status(400).json({ success: false, error: 'Invalid id' });
		}

		let updatedJob;
		let updatedProfileId;
		let mutationResult;
		if (status === 'clear') {
			const result = await clearJobBidStatus(applierName, id, { catalog, mutationId });
			mutationResult = result;
			updatedJob = result.job;
			updatedProfileId = result.profileId;
			const tasks = getVendorTasksCollection();
			if (tasks) void tasks.deleteMany({ applierName, jobId: id }).catch((error) => {
				console.warn('[jobs] deferred vendor task removal failed:', error?.message || error);
			});
		} else if (status === 'BidReady') {
			const result = await upsertJobBidStatus(applierName, id, { bidReady: true, catalog, mutationId });
			mutationResult = result;
			updatedJob = result.job;
			updatedProfileId = result.profileId;
			const tasks = getVendorTasksCollection();
			const now = new Date();
			const company =
				updatedJob.company && typeof updatedJob.company === 'object'
					? String(updatedJob.company.name || '')
					: String(updatedJob.companyName || '');
			const vendorPayload = {
				applierName,
				jobId: id,
				title: String(updatedJob.title || 'Untitled role'),
				company,
				applyUrl: String(updatedJob.applyLink || updatedJob.jobLink || '') || null,
				source: String(updatedJob.source || ''),
				location: String(updatedJob.details?.position || ''),
				workMode: String(updatedJob.details?.remote || ''),
				matchScore: null,
				status: 'pending',
				addedAt: now,
				updatedAt: now,
				completedAt: null,
			};
			void (
				tasks
					? tasks.updateOne(
							{ applierName, jobId: id },
							{
								$set: {
									title: vendorPayload.title,
									company: vendorPayload.company,
									applyUrl: vendorPayload.applyUrl,
									source: vendorPayload.source,
									location: vendorPayload.location,
									workMode: vendorPayload.workMode,
									status: 'pending',
									addedAt: now,
									updatedAt: now,
									completedAt: null,
									applierName,
									jobId: id,
								},
								$setOnInsert: {
									matchScore: null,
								},
							},
							{ upsert: true },
						)
					: Promise.resolve()
			).catch((error) => {
				console.warn('[jobs] deferred vendor task sync failed:', error?.message || error);
			});
		} else {
			const result = await upsertJobBidStatus(applierName, id, { bidReady: true, bidCompleted: true, catalog, mutationId });
			mutationResult = result;
			updatedJob = result.job;
			updatedProfileId = result.profileId;
		}
		syncMutationReadModel(mutationResult, id);
		jobCountCache.clear();
		return res.json({
			success: true,
			data: jobForProfile(updatedJob, updatedProfileId),
			...mutationMetadata(mutationResult),
		});
	} catch (err) {
		console.error('POST /api/jobs/:id/bid-status error', err);
		const statusCode = err.message === 'Invalid job id' || err.message === 'applierName is required'
			? 400
			: err.message === 'Job not found' || /^User .+ not found$/.test(err.message) ? 404 : 500;
		return res.status(statusCode).json({ success: false, error: err.message });
	}
}

/** POST /jobs/bid-status/bulk — one durable transaction for up to 150 jobs. */
export async function updateJobsBidStatusBulk(req, res) {
	try {
		if (!jobsCollection) return res.status(503).json({ success: false, error: 'Database not ready' });
		const applierName = String(req.body?.applierName ?? '').trim();
		const status = String(req.body?.status ?? '').trim();
		if (!applierName) return res.status(400).json({ success: false, error: 'applierName is required' });
		if (!['BidReady', 'clear'].includes(status)) {
			return res.status(400).json({ success: false, error: 'status must be BidReady or clear' });
		}
		const result = await mutateJobStatusesBulk({
			jobs: req.body?.jobs,
			applierName,
			transition: status === 'BidReady' ? 'bid-ready' : 'clear-bid',
			bulkMutationId: req.body?.mutationId,
		});
		for (const row of result.results) syncMutationReadModel(row, row.jobId);
		jobCountCache.clear();

		const tasks = getVendorTasksCollection();
		if (tasks && result.results.length) {
			if (status === 'clear') {
				void tasks.deleteMany({
					applierName,
					jobId: { $in: result.results.map((row) => row.jobId) },
				}).catch((error) => console.warn('[jobs] deferred bulk vendor task removal failed:', error?.message || error));
			} else {
				const now = new Date();
				const operations = result.results.map(({ jobId, job }) => {
					const company = job.company && typeof job.company === 'object'
						? String(job.company.name || '')
						: String(job.companyName || '');
					return { updateOne: {
						filter: { applierName, jobId },
						update: {
							$set: {
								applierName,
								jobId,
								title: String(job.title || 'Untitled role'),
								company,
								applyUrl: String(job.applyLink || job.jobLink || '') || null,
								source: String(job.source || ''),
								location: String(job.details?.position || ''),
								workMode: String(job.details?.remote || ''),
								status: 'pending',
								addedAt: now,
								updatedAt: now,
								completedAt: null,
							},
							$setOnInsert: { matchScore: null },
						},
						upsert: true,
					} };
				});
				void tasks.atomicBulkUpsert(operations)
					.catch((error) => console.warn('[jobs] deferred bulk vendor task sync failed:', error?.message || error));
			}
		}

		return res.json({
			success: true,
			updatedCount: result.results.length,
			failed: result.failed,
			results: result.results.map(({ jobId, viewerStatus, changed, statusVersion }) => ({
				jobId,
				viewerStatus,
				changed,
				statusVersion,
			})),
			cacheSync: result.cacheSync,
		});
	} catch (err) {
		console.error('POST /api/jobs/bid-status/bulk error', err);
		const statusCode = /required|Unsupported bulk|applierName/.test(err.message) ? 400
			: /^User .+ not found$/.test(err.message) ? 404 : 500;
		return res.status(statusCode).json({ success: false, error: err.message });
	}
}

/** Queue skill graph + LLM analysis for a job (Neo4j writes happen in background worker). */
export async function analyzeJob(req, res) {
	try {
		if (!jobsCollection) return res.status(503).json({ success: false, error: 'Database not ready' });
		const { id } = req.params;
		const applierName = req.body?.applierName || null;

		const result = await queueJobAnalysis(id, applierName);
		const statusCode = result.alreadyAnalyzed ? 200 : 202;
		return res.status(statusCode).json({ success: true, ...result });
	} catch (err) {
		const status = err.message === 'Job not found' ? 404 : err.message === 'Invalid job id' ? 400 : 500;
		console.error('POST /api/jobs/:id/analyze error', err);
		return res.status(status).json({ success: false, error: err.message });
	}
}

/** Full job document for View JD (description, skills, etc.). */
export async function getJobById(req, res) {
	try {
		if (!jobsCollection) return res.status(503).json({ success: false, error: 'Database not ready' });
		const { id } = req.params;
		if (!id || !DocumentId.isValid(id)) {
			return res.status(400).json({ success: false, error: 'Invalid job id' });
		}
		const doc = await jobsCollection.findOne(
			{ _id: new DocumentId(id) },
			{ projection: JOB_DETAIL_PROJECTION },
		);
		if (doc) {
			const applierName = String(req.query.applierName || '').trim();
			const account = applierName ? await resolveApplierContext(applierName) : null;
			if (isExtensionV2Job(doc)) {
				const canView = Boolean(account?.isBeta);
				if (!canView) {
					return res.status(404).json({ success: false, error: 'Job not found' });
				}
			}
			return res.json({
				success: true,
				data: jobForProfile(doc, account?.id ? String(account.id) : null),
			});
		}

		if (externalScrapedJobsCollection) {
			const externalDoc = await externalScrapedJobsCollection.findOne({ _id: new DocumentId(id) });
			if (externalDoc) {
				return res.json({ success: true, data: normalizeExternalScrapedJob(externalDoc) });
			}
		}

		return res.status(404).json({ success: false, error: 'Job not found' });
	} catch (err) {
		console.error(`GET /api/jobs/${req.params.id} error`, err);
		return res.status(500).json({ success: false, error: 'Failed to fetch job' });
	}
}

/** Authoritative status reconciliation after a lost mutation response. */
export async function getJobViewerStatus(req, res) {
	try {
		const { id } = req.params;
		if (!id || !DocumentId.isValid(id)) {
			return res.status(400).json({ success: false, error: 'Invalid job id' });
		}
		const applierName = String(req.query?.applierName || '').trim();
		if (!applierName) return res.status(400).json({ success: false, error: 'applierName is required' });
		const account = await resolveApplierContext(applierName);
		if (!account?.id) return res.status(404).json({ success: false, error: `User ${applierName} not found` });
		const catalog = String(req.query?.catalog || 'market').toLowerCase() === 'external' ? 'external' : 'market';
		const collection = catalog === 'external' ? externalScrapedJobsCollection : jobsCollection;
		const job = await collection?.findOne(
			{ _id: new DocumentId(id) },
			{ projection: { status: 1, sourceCatalog: 1 } },
		);
		if (!job) return res.status(404).json({ success: false, error: 'Job not found' });
		const row = mergeJobStatusRows(job.status, String(account.id));
		return res.json({
			success: true,
			jobId: id,
			catalog,
			viewerStatus: resolveJobStatusState(row),
			status: row ? [row] : [],
		});
	} catch (err) {
		console.error('GET /api/jobs/:id/viewer-status error', err);
		return res.status(500).json({ success: false, error: err.message });
	}
}

/** Skill-match radar data for job vs user resume graph. */
export async function getJobSkillRadar(req, res) {
	try {
		const { id } = req.params;
		const applierName = String(req.query.applierName || '').trim();
		const resumeId = req.query.resumeId ? String(req.query.resumeId) : undefined;
		const recommendedResumeId = req.query.recommendedResumeId
			? String(req.query.recommendedResumeId)
			: undefined;
		const recommendedTechStack = req.query.recommendedTechStack
			? String(req.query.recommendedTechStack)
			: undefined;
		const rankOnly = req.query.rankOnly === 'true' || req.query.rankOnly === '1';

		if (!applierName) {
			return res.status(400).json({ success: false, error: 'applierName query required' });
		}

		const data = await buildJobSkillRadar({
			jobId: id,
			applierName,
			resumeId,
			recommendedResumeId,
			recommendedTechStack,
			rankOnly,
		});
		return res.json({ success: true, ...data });
	} catch (err) {
		const status = err.message === 'Job not found'
			? 404
			: err.message === 'Invalid job id' || err.message === 'applierName is required'
				? 400
				: 500;
		console.error(`GET /api/jobs/${req.params.id}/skill-radar error`, err);
		return res.status(status).json({ success: false, error: err.message });
	}
}

/** Poll skill analysis status for a job. */
export async function getJobSkillAnalysis(req, res) {
	try {
		if (!jobsCollection) return res.status(503).json({ success: false, error: 'Database not ready' });
		const { id } = req.params;
		const result = await getJobAnalysisStatus(id);
		return res.json({ success: true, ...result });
	} catch (err) {
		const status = err.message === 'Job not found' ? 404 : err.message === 'Invalid job id' ? 400 : 500;
		return res.status(status).json({ success: false, error: err.message });
	}
}
