import { jobsCollection } from '../db/dataStore.js';
import { findAccountByApplierName } from '../services/mail/credentials.js';
import { isBetaTier } from '../lib/betaTier.js';
import {
	getTitleReviewCounts,
	invalidateTitleReviewCounts,
} from '../services/jobTitleReview/titleReviewSession.js';
import {
	createBackgroundTask,
	findActiveBackgroundTask,
	listBackgroundTasks,
	requestBackgroundTaskCancellation,
} from '../services/backgroundTasks/taskStore.js';
import { BACKGROUND_TASK_TYPES, publicTaskSnapshot } from '../services/backgroundTasks/taskTypes.js';
import {
	listTitleReviewReadModel,
	patchTitleReviewReadModel,
} from '../services/jobTitleReview/titleReviewReadModel.js';
import { TitleReviewQueryError } from '../services/jobTitleReview/titleReviewQueryService.js';
import { syncJobTitleReviewUpdates } from '../services/jobTitleReview/titleReviewIndexSync.js';
import { normalizeJobRemovalIds } from '../services/jobRemovalService.js';
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

function titleTaskIdentity(req, applierName) {
	const name = String(applierName || req.authProfile?.profileName || req.authProfile?.applierName || '').trim();
	return {
		applierName: name,
		profileId: String(req.authProfile?.profileId || req.body?.profileId || req.query?.profileId || '').trim()
			|| name.toLocaleLowerCase('en-US'),
		ownerUid: String(req.auth?.uid || '').trim() || null,
	};
}

async function latestTitleTask(profileId) {
	const active = await findActiveBackgroundTask(profileId, BACKGROUND_TASK_TYPES.TITLE_REVIEW);
	if (active) return active;
	const tasks = await listBackgroundTasks(profileId, { limit: 20 });
	return tasks.find((task) => task.type === BACKGROUND_TASK_TYPES.TITLE_REVIEW) || null;
}

function titleSession(task, counts = {}) {
	if (!task) return { running: false, status: 'idle', ...counts };
	const progress = task.progress || {};
	const status = task.status === 'queued'
		? 'running'
		: task.status === 'cancelling'
			? 'stopping'
			: task.status === 'completed_with_errors' ? 'completed' : task.status;
	return {
		running: ['queued', 'running', 'cancelling'].includes(task.status),
		status,
		phase: progress.phase ?? null,
		sessionId: task.id,
		total: progress.total ?? null,
		processed: progress.completed ?? 0,
		approved: progress.approved ?? 0,
		reviewRequired: progress.reviewRequired ?? 0,
		failed: progress.failed ?? 0,
		remaining: progress.remaining ?? null,
		startedAt: task.startedAt,
		finishedAt: task.finishedAt,
		error: task.error,
		concurrency: 10,
		batchSize: 10,
		...counts,
	};
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
		const identity = titleTaskIdentity(req, applierName);
		const [task, counts] = await Promise.all([
			latestTitleTask(identity.profileId),
			getTitleReviewCounts(),
		]);
		return res.json({ success: true, ...titleSession(task, counts) });
	} catch (error) {
		console.error('GET /api/jobs/title-review/status error', error);
		return res.status(500).json({ success: false, error: error.message });
	}
}

export async function startTitleReview(req, res) {
	try {
		const applierName = await requireBetaApplierName(req.body?.applierName, res);
		if (!applierName) return;
		const identity = titleTaskIdentity(req, applierName);
		const result = await createBackgroundTask({
			requestId: req.body?.requestId,
			type: BACKGROUND_TASK_TYPES.TITLE_REVIEW,
			...identity,
			payload: {},
		});
		return res.status(result.created ? 202 : 200).json({
			success: true,
			started: result.created,
			sessionId: result.task.id,
			pending: null,
			...(result.alreadyActive ? { message: 'Title review is already running.' } : {}),
		});
	} catch (error) {
		const status = Number.isInteger(error?.status) ? error.status : 500;
		console.error('POST /api/jobs/title-review/start error', error);
		return res.status(status).json({ success: false, error: error.message });
	}
}

export async function stopTitleReview(req, res) {
	try {
		const applierName = await requireBetaApplierName(
			req.body?.applierName || req.authProfile?.profileName || req.authProfile?.applierName,
			res,
		);
		if (!applierName) return;
		const identity = titleTaskIdentity(req, applierName);
		const task = await findActiveBackgroundTask(identity.profileId, BACKGROUND_TASK_TYPES.TITLE_REVIEW);
		if (!task) return res.json({ success: true, stopped: false, message: 'No active session' });
		const next = await requestBackgroundTaskCancellation(task.id);
		return res.status(202).json({ success: true, stopped: true, sessionId: next.id, status: next.status });
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
		const identity = titleTaskIdentity(req, applierName);
		const session = titleSession(await latestTitleTask(identity.profileId), result.counts || {});
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
		const existing = await jobsCollection.find(
			{ _id: { $in: requestedIds } },
			{ projection: { _id: 1, titleReview: 1 } },
		).toArray();
		const existingById = new Map(existing.map((job) => [String(job._id), job]));
		const safeIds = requestedIds.filter((id) => {
			const job = existingById.get(id);
			return !job
				|| job.titleReview?.label === 'REVIEW_REQUIRED'
				|| job.titleReview?.processingState === 'failed';
		});
		if (!safeIds.length) {
			return res.json({
				success: true,
				deletedCount: 0,
				deletedIds: [],
				removedCount: 0,
				removedIds: [],
				alreadyAbsentCount: 0,
			});
		}
		const queued = await createBackgroundTask({
			requestId: req.body?.requestId,
			type: BACKGROUND_TASK_TYPES.JOB_REMOVAL,
			...titleTaskIdentity(req, applierName),
			payload: { recordIds: safeIds },
			progress: {
				total: safeIds.length,
				targetIds: safeIds,
				operation: 'title_review_job_removal',
			},
		});
		return res.status(queued.created ? 202 : 200).json({
			success: true,
			created: queued.created,
			duplicate: queued.duplicate === true,
			task: publicTaskSnapshot(queued.task),
		});
	} catch (error) {
		console.error('POST /api/jobs/title-review/remove error', error);
		return res.status(Number.isInteger(error?.status) ? error.status : 500).json({ success: false, error: error.message });
	}
}
