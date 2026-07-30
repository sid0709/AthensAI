import { jobsCollection } from '../db/dataStore.js';
import { findAccountByApplierName } from '../services/mail/credentials.js';
import { isBetaTier } from '../lib/betaTier.js';
import {
	getTitleReviewSessionStatus,
	invalidateTitleReviewCounts,
	startTitleReviewSession,
	stopTitleReviewSession,
} from '../services/jobTitleReview/titleReviewSession.js';
import {
	listTitleReviewReadModel,
	patchTitleReviewReadModel,
} from '../services/jobTitleReview/titleReviewReadModel.js';
import { TitleReviewQueryError } from '../services/jobTitleReview/titleReviewQueryService.js';
import { syncJobTitleReviewUpdates } from '../services/jobTitleReview/titleReviewIndexSync.js';
import { normalizeJobRemovalIds, deleteJobDocuments } from '../services/jobRemovalService.js';
import { deleteScoresForJobs } from '../services/matching/matchScoreStore.js';
import { removeJobsFromRanking } from '../services/matching/jobRankingIndex.js';
import { evictJobsFromJobListReadModel } from '../services/jobListReadModelService.js';
import { invalidateLiveProjectedStatusCount } from '../services/jobStatusProjectionService.js';
import { observeHistogram } from '../services/monitoring/metrics.js';
import { invalidateJobListCountCache } from './jobController.js';

async function requireBetaApplierName(applierNameRaw, res) {
	const applierName = String(applierNameRaw || '').trim();
	if (!applierName) {
		res.status(400).json({ success: false, error: 'applierName is required.' });
		return null;
	}
	const account = await findAccountByApplierName(applierName);
	if (!account) {
		res.status(404).json({ success: false, error: `No account named "${applierName}".` });
		return null;
	}
	if (!isBetaTier(account.tier)) {
		res.status(403).json({ success: false, error: 'Beta workspace required.', betaRequired: true });
		return null;
	}
	return applierName;
}

function setReviewTiming(res, { auth = 0, cache = 0, firestore = 0, serialization = 0, total = 0 } = {}) {
	res.setHeader('Server-Timing', [
		`title-review-auth;dur=${Number(auth).toFixed(1)}`,
		`title-review-cache;dur=${Number(cache).toFixed(1)}`,
		`title-review-firestore;dur=${Number(firestore).toFixed(1)}`,
		`title-review-serialization;dur=${Number(serialization).toFixed(1)}`,
		`title-review-total;dur=${Number(total).toFixed(1)}`,
	].join(', '));
}

function titleReviewErrorResponse(error, res, startedAt, authMs = 0) {
	const status = error instanceof TitleReviewQueryError ? error.status : 500;
	if (error?.retryAfter) res.setHeader('Retry-After', String(error.retryAfter));
	setReviewTiming(res, { auth: authMs, total: performance.now() - startedAt });
	return res.status(status).json({
		success: false,
		error: error.message,
		code: error.code || 'TITLE_REVIEW_REQUEST_FAILED',
		retryable: status === 503,
		retryAfter: error.retryAfter || undefined,
	});
}

export async function getTitleReviewStatus(req, res) {
	try {
		const applierName = await requireBetaApplierName(req.query?.applierName, res);
		if (!applierName) return;
		return res.json({ success: true, ...(await getTitleReviewSessionStatus()) });
	} catch (error) {
		console.error('GET /api/jobs/title-review/status error', error);
		return res.status(500).json({ success: false, error: error.message });
	}
}

export async function startTitleReview(req, res) {
	try {
		const applierName = await requireBetaApplierName(req.body?.applierName, res);
		if (!applierName) return;
		const result = await startTitleReviewSession({ applierName });
		return res.status(result.started ? 202 : 200).json({ success: true, ...result });
	} catch (error) {
		const status = error.message.includes('already running') ? 409 : 400;
		console.error('POST /api/jobs/title-review/start error', error);
		return res.status(status).json({ success: false, error: error.message });
	}
}

export async function stopTitleReview(req, res) {
	try {
		const applierName = await requireBetaApplierName(req.body?.applierName, res);
		if (!applierName) return;
		return res.json({ success: true, ...stopTitleReviewSession() });
	} catch (error) {
		console.error('POST /api/jobs/title-review/stop error', error);
		return res.status(500).json({ success: false, error: error.message });
	}
}

export async function listTitleReviewJobs(req, res) {
	const startedAt = performance.now();
	let authMs = 0;
	try {
		const authStartedAt = performance.now();
		const applierName = await requireBetaApplierName(req.query?.applierName, res);
		authMs = performance.now() - authStartedAt;
		observeHistogram('athens_title_review_auth_duration_seconds', {}, authMs / 1_000);
		if (!applierName) return;
		const result = await listTitleReviewReadModel(req.query || {});
		const totalMs = performance.now() - startedAt;
		result.meta.serverDurationMs = totalMs;
		setReviewTiming(res, {
			auth: authMs,
			cache: result.meta.cacheLookupMs,
			firestore: result.meta.firestoreMs,
			serialization: result.meta.serializationMs,
			total: totalMs,
		});
		res.setHeader('X-Title-Review-Revision', result.meta.revision);
		res.setHeader('X-Title-Review-Cache', result.meta.cacheSource);
		return res.json({ success: true, ...result });
	} catch (error) {
		console.error('GET /api/jobs/title-review error', error);
		return titleReviewErrorResponse(error, res, startedAt, authMs);
	}
}

/** One authenticated round trip for the initial page, counts, and live session state. */
export async function getTitleReviewBootstrap(req, res) {
	const startedAt = performance.now();
	let authMs = 0;
	try {
		const authStartedAt = performance.now();
		const applierName = await requireBetaApplierName(req.query?.applierName, res);
		authMs = performance.now() - authStartedAt;
		observeHistogram('athens_title_review_auth_duration_seconds', {}, authMs / 1_000);
		if (!applierName) return;
		const result = await listTitleReviewReadModel(req.query || {});
		const session = await getTitleReviewSessionStatus({ preferredCounts: result.counts });
		const totalMs = performance.now() - startedAt;
		result.meta.serverDurationMs = totalMs;
		setReviewTiming(res, {
			auth: authMs,
			cache: result.meta.cacheLookupMs,
			firestore: result.meta.firestoreMs,
			serialization: result.meta.serializationMs,
			total: totalMs,
		});
		res.setHeader('X-Title-Review-Revision', result.meta.revision);
		res.setHeader('X-Title-Review-Cache', result.meta.cacheSource);
		return res.json({ success: true, session, ...result });
	} catch (error) {
		console.error('GET /api/jobs/title-review/bootstrap error', error);
		return titleReviewErrorResponse(error, res, startedAt, authMs);
	}
}

export async function approveTitleReviewJobs(req, res) {
	try {
		const applierName = await requireBetaApplierName(req.body?.applierName, res);
		if (!applierName) return;
		if (!jobsCollection) return res.status(503).json({ success: false, error: 'Database not ready' });
		const ids = normalizeJobRemovalIds(req.body);
		if (!ids.length) return res.status(400).json({ success: false, error: 'Missing ids array' });
		const eligible = await jobsCollection.find({
			_id: { $in: ids },
			'titleReview.label': 'REVIEW_REQUIRED',
		}, { projection: { _id: 1 } }).toArray();
		const now = new Date().toISOString();
		const writes = await Promise.all(eligible.map(async (job) => ({
			id: String(job._id),
			result: await jobsCollection.updateOne(
				{ _id: job._id, 'titleReview.label': 'REVIEW_REQUIRED' },
				{
					$set: {
						'titleReview.processingState': 'completed',
						'titleReview.label': 'APPROVED',
						'titleReview.decisionSource': 'manual',
						'titleReview.approvedAt': now,
						'titleReview.approvedBy': applierName,
					},
					$unset: { 'titleReview.error': '', 'titleReview.lease': '' },
				},
			),
		})));
		const approvedIds = writes.filter(({ result }) => result.modifiedCount).map(({ id }) => id);
		if (approvedIds.length) {
			try {
				await syncJobTitleReviewUpdates(Object.fromEntries(approvedIds.map((id) => [id, 'APPROVED'])));
			} catch (error) {
				console.warn('[title-review] approval read-model sync failed', error?.message || error);
			}
			invalidateJobListCountCache();
			invalidateTitleReviewCounts();
			await patchTitleReviewReadModel({ approvedIds });
		}
		return res.json({ success: true, approvedCount: approvedIds.length, approvedIds });
	} catch (error) {
		console.error('POST /api/jobs/title-review/approve error', error);
		return res.status(500).json({ success: false, error: error.message });
	}
}

export async function removeTitleReviewJobs(req, res) {
	try {
		const applierName = await requireBetaApplierName(req.body?.applierName, res);
		if (!applierName) return;
		if (!jobsCollection) return res.status(503).json({ success: false, error: 'Database not ready' });
		const requestedIds = normalizeJobRemovalIds(req.body);
		if (!requestedIds.length) return res.status(400).json({ success: false, error: 'Missing ids array' });
		const eligible = await jobsCollection.find({
			_id: { $in: requestedIds },
			$or: [
				{ 'titleReview.label': 'REVIEW_REQUIRED' },
				{ 'titleReview.processingState': 'failed' },
			],
		}, { projection: { _id: 1 } }).toArray();
		const ids = eligible.map((job) => String(job._id));
		if (!ids.length) return res.json({ success: true, deletedCount: 0, deletedIds: [] });
		const { deletedCount } = await deleteJobDocuments({ ids, jobsCollection });
		evictJobsFromJobListReadModel(ids);
		invalidateLiveProjectedStatusCount();
		invalidateJobListCountCache();
		invalidateTitleReviewCounts();
		await patchTitleReviewReadModel({ deletedIds: ids });
		await Promise.allSettled([deleteScoresForJobs(ids), removeJobsFromRanking(ids)]);
		return res.json({ success: true, deletedCount, deletedIds: ids });
	} catch (error) {
		console.error('POST /api/jobs/title-review/remove error', error);
		return res.status(500).json({ success: false, error: error.message });
	}
}
