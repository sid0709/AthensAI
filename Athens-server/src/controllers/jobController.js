import { randomUUID } from 'node:crypto';
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
import {
	JOB_MARKET_MODEL_VERSION,
	excludeExtensionV2JobsFilter,
	isExtensionV2Job,
	stripScraperOnlyJobFields,
} from '../config/jobMarketSchema.js';
import {
	classifyJobMarketIngest,
	duplicateJobResult,
	isWithinDuplicateDateWindow,
	normalizeExtensionV2OriginalJob,
	requiresClientDuplicateWindow,
	resolveJobPostedAt,
	stampJobMarketIngestVersion,
	validateClientDuplicateWindowDays,
	validateExtensionV2OriginalJob,
} from '../services/jobMarketIngest.js';
import { JobSourceTitles } from '../config/jobSources.js';
import { isBetaTier } from '../lib/betaTier.js';
import {
	JOB_DETAIL_PROJECTION,
	resolveApplierContext,
} from '../services/jobListQuery.js';
import { queueJobAnalysis, getJobAnalysisStatus } from '../services/jobAnalysis/index.js';
import { normalizeExternalScrapedJob } from '../services/externalScrapedJobsListQuery.js';
import { normalizeJobSkills, jobSkillTokens } from '../services/matching/skillIndex.js';
import { buildJobSkillRadar } from '../services/jobSkillRadarService.js';
import {
	clearJobBidStatus,
	upsertJobBidStatus,
} from '../services/jobBidStatusService.js';
import {
	invalidateLiveProjectedStatusCount,
	mutateJobStatus,
	mutateJobStatusesBulk,
	readProjectedJobStatuses,
	syncJobStatusVisibility,
} from '../services/jobStatusProjectionService.js';
import { findDuplicateByUrl } from '../services/jobDuplicateLookup.js';
import {
	claimJobIdentity,
	finalizeJobIdentityClaim,
	JOB_IDENTITY_LOOKBACK_DAYS,
	releaseJobIdentityClaim,
} from '../services/jobIdentityDedupe.js';
import { applyCompanyIdentity, resolveCompanyIdentity } from '../services/companyIdentity.js';
import {
	getJobStatusCountsV3 as countJobsV3,
	invalidateJobListV3Counts,
	listJobsV3,
} from '../services/jobListV3Service.js';
import {
	deleteJobDocuments,
	findOtherCompanyJobIds,
	normalizeCompanySiblingRemoval,
	normalizeJobRemovalIds,
	resolveJobRemovalTaskIdentity,
} from '../services/jobRemovalService.js';
import { syncApprovedCatalogMembership } from '../services/jobCatalogCountService.js';
import { ingestJobsBulk, MAX_JOB_BULK_SIZE } from '../services/jobBulkIngest.js';
import {
	patchTitleReviewReadModel,
} from '../services/jobTitleReview/titleReviewReadModel.js';
import { mapTitleReviewDocument } from '../services/jobTitleReview/titleReviewQueryService.js';
import { invalidatePendingExtractionCount } from '../services/jobSkillExtraction/extractSession.js';
import { createBackgroundTask } from '../services/backgroundTasks/taskStore.js';
import { normalizeBackgroundTaskPayload } from '../services/backgroundTasks/taskPayload.js';
import { BACKGROUND_TASK_TYPES, publicTaskSnapshot } from '../services/backgroundTasks/taskTypes.js';
import { firestoreMutationLimiter } from '../services/backgroundTasks/resourceLimits.js';
import { runWithoutBackgroundTaskContext } from '../services/backgroundTasks/taskContext.js';

export function invalidateJobListCountCache() {
	invalidateJobListV3Counts();
}

async function enqueueJobRemoval(req, ids, operation) {
	const normalized = normalizeJobRemovalIds({ ids });
	if (!normalized.length) throw Object.assign(new Error('Missing ids array'), { status: 400 });
	const payload = normalizeBackgroundTaskPayload(BACKGROUND_TASK_TYPES.JOB_REMOVAL, {
		recordIds: normalized,
	});
	if (payload.recordIds.length !== normalized.length) {
		throw Object.assign(new Error('Too many jobs for one background task'), { status: 413 });
	}
	return createBackgroundTask({
		requestId: String(req.body?.requestId || '').trim() || randomUUID(),
		type: BACKGROUND_TASK_TYPES.JOB_REMOVAL,
		...resolveJobRemovalTaskIdentity(req),
		payload,
		progress: {
			total: normalized.length,
			targetIds: normalized,
			operation,
		},
	});
}

function queuedRemovalResponse(res, queued) {
	return res.status(queued.created ? 202 : 200).json({
		success: true,
		created: queued.created,
		duplicate: queued.duplicate === true,
		task: publicTaskSnapshot(queued.task),
	});
}

function throwIfRemovalAborted(signal) {
	if (!signal?.aborted) return;
	throw signal.reason instanceof Error
		? signal.reason
		: Object.assign(new Error('Job removal cancelled'), { name: 'AbortError' });
}

/** Shared worker-safe implementation for permanent bulk job removal. */
export async function removeJobRecords(ids, { signal } = {}) {
	if (!jobsCollection) throw new Error('Database not ready');
	const normalized = normalizeJobRemovalIds({ ids });
	if (!normalized.length) return { deletedCount: 0, deletedIds: [] };
	throwIfRemovalAborted(signal);
	const { deletedCount } = await firestoreMutationLimiter.run(() => deleteJobDocuments({ ids: normalized, jobsCollection }));
	// Once the authoritative delete commits, its derived indexes and caches must
	// converge even if Stop arrives during that delete. This is consistency
	// cleanup for an already-started item, not a new item or provider call.
	await runWithoutBackgroundTaskContext(async () => {
		if (deletedCount) invalidatePendingExtractionCount();
		if (deletedCount) await syncApprovedCatalogMembership(normalized);
		if (deletedCount) await syncJobStatusVisibility(normalized);
		await firestoreMutationLimiter.run(() => patchTitleReviewReadModel({ deletedIds: normalized }));
		invalidateLiveProjectedStatusCount();
		invalidateJobListV3Counts();
	});
	throwIfRemovalAborted(signal);
	return { deletedCount, deletedIds: normalized };
}
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
	const source = Array.isArray(jobs) ? jobs : [];
	if (!profileId) return source.map((job) => jobForProfile(job, null));
	const projected = await readProjectedJobStatuses(profileId, source.map((job) => String(job._id)));
	return source.map((job) => jobForProfile({ ...job, status: projected.get(String(job._id)) || [] }, profileId));
}

function syncMutationReadModel(result, jobId) {
	void result;
	void jobId;
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

const toValidDate = (value) => {
	if (!value) return null;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
};

const extractJobTimestamp = (jobDoc) => {
	return toValidDate(jobDoc?.postedAt) || toValidDate(jobDoc?._createdAt) || toValidDate(jobDoc?.createdAt);
};

/** True when an existing URL falls within the request's duplicate window. */
const isWithinDuplicateWindow = (existingJob, newPostedAt, lookbackDays) => {
	const existingTimestamp = extractJobTimestamp(existingJob);
	return isWithinDuplicateDateWindow(existingTimestamp, newPostedAt, lookbackDays);
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
		const duplicateWindow = validateClientDuplicateWindowDays(job.duplicateWindowDays, {
			required: requiresClientDuplicateWindow(job, ingest),
		});
		if (!duplicateWindow.valid) {
			return res.status(422).json({
				success: false,
				created: false,
				code: 'INVALID_DUPLICATE_WINDOW',
				error: duplicateWindow.error,
				reason: duplicateWindow.error,
			});
		}
		const duplicateWindowDays = duplicateWindow.days ?? JOB_IDENTITY_LOOKBACK_DAYS;

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
			if (existingByUrl && isWithinDuplicateWindow(existingByUrl, postedAt, duplicateWindowDays)) {
				return res.status(200).json(duplicateJobResult({
					existingId: existingByUrl._id,
					reason: `Job with this URL has been posted within the last ${duplicateWindowDays} days`,
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
			lookbackDays: duplicateWindowDays,
		});
		if (identityClaim.duplicate) {
			return res.status(200).json(duplicateJobResult({
				existingId: identityClaim.existingJobId ? String(identityClaim.existingJobId) : '',
				reason: `Duplicate job with this company and title was added within the last ${duplicateWindowDays} days`,
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

		// Queue for AI skill extraction (run manually from the Extract skills button).
		job.aiSkillStatus = 'pending';
		// A queryable state keeps the title-review queue indexed. Missing-field
		// checks force Firestore to scan the entire catalog.
		job.titleReview = { processingState: 'pending' };
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
			if (!req.deferSkillPendingInvalidation) invalidatePendingExtractionCount();
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
		(job) => createJobRecord(job, {
			client,
			deferTitleReviewRevision: true,
			deferSkillPendingInvalidation: true,
		}),
	);
	if (summary.created > 0 && jobsCollection) {
		invalidatePendingExtractionCount();
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
export async function createJobRecord(job, {
	client = 'agent-manual',
	deferTitleReviewRevision = false,
	deferSkillPendingInvalidation = false,
} = {}) {
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
	await createJob({
		body: job,
		get: () => client,
		deferTitleReviewRevision,
		deferSkillPendingInvalidation,
	}, response);
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
		if (!doomed.length) return res.json({ success: true, deletedCount: 0, deletedIds: [] });
		const queued = await enqueueJobRemoval(req, doomed.map((doc) => String(doc._id)), 'rule_job_removal');
		return queuedRemovalResponse(res, queued);
	} catch (err) {
		console.error(`DELETE /api/jobs/rule/${req.params.name} error`, err);
		return res.status(Number.isInteger(err?.status) ? err.status : 500).json({ success: false, error: err.message });
	}
}

/** Firestore-authoritative, approval-gated, newest-only Job Search. */
export async function getJobsV3(req, res) {
	const started = performance.now();
	try {
		if (String(process.env.JOB_LIST_V3_ENABLED || 'true').toLowerCase() === 'false') {
			return res.status(404).json({ success: false, error: 'Job Search v3 is disabled' });
		}
		const result = await listJobsV3(req.body || {});
		res.setHeader('Server-Timing', `jobs-v3-total;dur=${(performance.now() - started).toFixed(1)}`);
		return res.json(result);
	} catch (err) {
		console.error('POST /api/jobs/list/v3 error', err);
		return res.status(Number.isInteger(err?.status) ? err.status : 503).json({
			success: false,
			retryable: err?.retryable !== false,
			error: err.message,
		});
	}
}

export async function getJobStatusCountsV3(req, res) {
	try {
		const counts = await countJobsV3(req.body || {});
		return res.json({ success: true, counts });
	} catch (err) {
		console.error('POST /api/jobs/list/v3/counts error', err);
		return res.status(Number.isInteger(err?.status) ? err.status : 503).json({
			success: false,
			retryable: err?.retryable !== false,
			error: err.message,
		});
	}
}

export async function applyToJob(req, res) {
	try {
		if (!jobsCollection) return res.status(503).json({ success: false, error: 'Database not ready' });
		const { id } = req.params;
		const { applierName, catalog, mutationId } = req.body;
		const result = await mutateJobStatus({ jobId: id, applierName, transition: 'apply', catalog, mutationId });
		syncMutationReadModel(result, id);
		invalidateJobListV3Counts();
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
		invalidateJobListV3Counts();
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

		const queued = await enqueueJobRemoval(req, ids, 'job_removal');
		return queuedRemovalResponse(res, queued);
	} catch (err) {
		console.error('POST /api/jobs/remove error', err);
		return res.status(Number.isInteger(err?.status) ? err.status : 500).json({ success: false, error: err.message });
	}
}

export async function removeOtherCompanyJobs(req, res) {
	try {
		if (!jobsCollection) return res.status(503).json({ success: false, error: 'Database not ready' });
		const input = normalizeCompanySiblingRemoval(req.body);
		if (!input) {
			return res.status(400).json({ success: false, error: 'companyId and keepJobId are required' });
		}

		const ids = await findOtherCompanyJobIds({ ...input, jobsCollection });
		if (!ids.length) return res.json({ success: true, deletedCount: 0, deletedIds: [] });

		const queued = await enqueueJobRemoval(req, ids.map(String), 'company_sibling_job_removal');
		return queuedRemovalResponse(res, queued);
	} catch (err) {
		console.error('POST /api/jobs/company/remove-others error', err);
		const status = err?.code === 'COMPANY_GROUP_CHANGED'
			? 409
			: Number.isInteger(err?.status) ? err.status : 500;
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
		invalidateJobListV3Counts();
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
		invalidateJobListV3Counts();
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
		invalidateJobListV3Counts();

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
		const applierName = req.body?.applierName || req.authProfile?.profileName || req.authProfile?.applierName || null;

		const result = await queueJobAnalysis(id, applierName, {
			requestId: req.body?.requestId,
			ownerUid: req.auth?.uid,
			profileId: req.authProfile?.profileId,
		});
		const statusCode = result.alreadyAnalyzed ? 200 : 202;
		return res.status(statusCode).json({ success: true, ...result });
	} catch (err) {
		const status = Number.isInteger(err?.status)
			? err.status
			: err.message === 'Job not found' ? 404 : err.message === 'Invalid job id' ? 400 : 500;
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
			const profileId = account?.id ? String(account.id) : null;
			const projected = profileId ? await readProjectedJobStatuses(profileId, [id]) : new Map();
			const jobPayload = jobForProfile({ ...doc, status: projected.get(id) || [] }, profileId);

			if (applierName) {
				const tasks = getVendorTasksCollection();
				const task = tasks
					? await tasks.findOne(
						{ applierName, jobId: id },
						{
							projection: {
								recommendedResumeStack: 1,
								recommendedResumeReason: 1,
								useCustomizedResume: 1,
								recommendWarning: 1,
								recommendedAt: 1,
								recommendMode: 1,
							},
						},
					)
					: null;
				if (task) {
					jobPayload.recommendedResumeStack = task.recommendedResumeStack || null;
					jobPayload.recommendedResumeReason = task.recommendedResumeReason || null;
					jobPayload.useCustomizedResume = Boolean(task.useCustomizedResume);
					jobPayload.recommendWarning = task.recommendWarning || null;
					jobPayload.recommendedAt =
						task.recommendedAt instanceof Date
							? task.recommendedAt.toISOString()
							: task.recommendedAt || null;
					jobPayload.recommendMode = task.recommendMode || null;
				}
			}

			return res.json({
				success: true,
				data: jobPayload,
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
			{ projection: { sourceCatalog: 1 } },
		);
		if (!job) return res.status(404).json({ success: false, error: 'Job not found' });
		const projected = await readProjectedJobStatuses(String(account.id), [id]);
		const row = mergeJobStatusRows(projected.get(id), String(account.id));
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
