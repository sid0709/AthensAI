/** High-throughput title review session: 10 concurrent requests × 10 titles. */
import { randomUUID } from 'crypto';
import { jobsCollection } from '../../db/dataStore.js';
import { formatCostUsd } from '../llm/llmService.js';
import {
	TITLE_REVIEW_BATCH_SIZE,
	classifyAndPersistTitleReviewBatch,
	recordTitleReviewBatchFailure,
	resolveExtractionAuth,
} from './titleReviewService.js';

const configuredConcurrency = Number(process.env.JOB_TITLE_REVIEW_CONCURRENCY || 10);
export const TITLE_REVIEW_CONCURRENCY = Number.isFinite(configuredConcurrency)
	? Math.max(1, Math.min(10, Math.floor(configuredConcurrency)))
	: 10;
const configuredStaleLeaseMs = Number(process.env.JOB_TITLE_REVIEW_STALE_LEASE_MS || 15 * 60_000);
const STALE_LEASE_MS = Number.isFinite(configuredStaleLeaseMs)
	? Math.max(60_000, configuredStaleLeaseMs)
	: 15 * 60_000;
const CLAIM_PROJECTION = { title: 1, postedAt: 1, titleReview: 1 };
export const TITLE_REVIEW_LIST_PROJECTION = {
	title: 1,
	company: 1,
	companyName: 1,
	source: 1,
	postedAt: 1,
	_createdAt: 1,
	applyLink: 1,
	jobLink: 1,
	titleReview: 1,
};

let activeSession = null;
let cancelRequested = false;
const inflight = new Set();
let countsCache = null;
const COUNTS_CACHE_MS = 2_000;

export function invalidateTitleReviewCounts() {
	countsCache = null;
}

export function pendingTitleReviewQuery() {
	return { 'titleReview.processingState': { $in: ['pending', 'failed'] } };
}

export async function getTitleReviewCounts() {
	if (!jobsCollection) return {
		pending: null,
		unreviewedCount: null,
		reviewRequiredCount: null,
		failedCount: null,
	};
	if (countsCache?.expiresAt > Date.now()) return countsCache.promise;
	const promise = Promise.all([
		jobsCollection.countDocuments({ 'titleReview.processingState': { $in: ['pending', 'failed'] } }),
		jobsCollection.countDocuments({ 'titleReview.processingState': { $in: ['pending', 'scanning'] } }),
		jobsCollection.countDocuments({ 'titleReview.label': 'REVIEW_REQUIRED' }),
		jobsCollection.countDocuments({ 'titleReview.processingState': 'failed' }),
	]).then(([pending, unreviewedCount, reviewRequiredCount, failedCount]) => ({
		pending,
		unreviewedCount,
		reviewRequiredCount,
		failedCount,
	}));
	countsCache = { promise, expiresAt: Date.now() + COUNTS_CACHE_MS };
	promise.catch(() => {
		if (countsCache?.promise === promise) countsCache = null;
	});
	return promise;
}

/** Prime the two first-page reads before the API is marked ready. */
export async function warmTitleReviewReadCache() {
	if (!jobsCollection) return { warmed: false };
	const results = await Promise.allSettled([
		getTitleReviewCounts(),
		jobsCollection.find(
			{ 'titleReview.processingState': { $in: ['pending', 'scanning'] } },
			{ projection: TITLE_REVIEW_LIST_PROJECTION },
		).limit(50).toArray(),
		jobsCollection.find(
			{ 'titleReview.label': 'REVIEW_REQUIRED' },
			{ projection: TITLE_REVIEW_LIST_PROJECTION },
		).sort({ 'titleReview.confidence': -1, postedAt: -1, _id: -1 }).limit(50).toArray(),
	]);
	const failures = results.filter((result) => result.status === 'rejected');
	if (failures.length) {
		console.warn('[job-title-review] cache warmup incomplete:', failures[0].reason?.message || failures[0].reason);
	}
	return { warmed: failures.length === 0 };
}

async function recoverStaleLeases() {
	if (!jobsCollection) return 0;
	const cutoff = new Date(Date.now() - STALE_LEASE_MS).toISOString();
	let recovered = 0;
	for (;;) {
		const stale = await jobsCollection.find({
			'titleReview.processingState': 'scanning',
			'titleReview.lease.claimedAt': { $lt: cutoff },
		}, { projection: { _id: 1 } }).limit(1_000).toArray();
		if (!stale.length) break;
		const result = await jobsCollection.bulkWrite(stale.map((job) => ({
			updateOne: {
				filter: { _id: job._id, 'titleReview.processingState': 'scanning' },
				update: {
					$set: { 'titleReview.processingState': 'pending' },
					$unset: { 'titleReview.lease': '', 'titleReview.error': '' },
				},
			},
		})), { ordered: false });
		recovered += result.modifiedCount || 0;
		if (stale.length < 1_000) break;
	}
	if (recovered) invalidateTitleReviewCounts();
	return recovered;
}

async function claimBatch(session, limit) {
	if (!jobsCollection || limit <= 0) return [];
	const claimedJobs = [];
	while (claimedJobs.length < limit && session.queue.length) {
		const candidates = session.queue.splice(0, limit - claimedJobs.length);
		const claimedAt = new Date().toISOString();
		const claimedIds = await jobsCollection.atomicClaimMany(
			candidates.map((job) => job._id),
			pendingTitleReviewQuery(),
			{
				$set: {
					'titleReview.processingState': 'scanning',
					'titleReview.lease.sessionId': session.id,
					'titleReview.lease.claimedAt': claimedAt,
				},
			},
		);
		const claimed = new Set(claimedIds.map(String));
		claimedJobs.push(...candidates.filter((job) => claimed.has(String(job._id))));
	}
	return claimedJobs;
}

async function loadPendingQueue() {
	const queue = [];
	for await (const job of jobsCollection.findPaged(pendingTitleReviewQuery(), {
		projection: CLAIM_PROJECTION,
		pageSize: 1_000,
	})) {
		queue.push(job);
	}
	queue.sort((left, right) => {
		const leftTime = Date.parse(left.postedAt || 0) || 0;
		const rightTime = Date.parse(right.postedAt || 0) || 0;
		return rightTime - leftTime || String(right._id).localeCompare(String(left._id));
	});
	return queue;
}

async function releaseBatch(jobs, sessionId) {
	if (!jobsCollection || !jobs?.length) return;
	await jobsCollection.bulkWrite(jobs.map((job) => ({
		updateOne: {
			filter: { _id: job._id, 'titleReview.lease.sessionId': sessionId },
			update: {
				$set: { 'titleReview.processingState': 'pending' },
				$unset: { 'titleReview.lease': '', 'titleReview.error': '' },
			},
		},
	})), { ordered: false }).catch(() => undefined);
}

async function processBatch(session, auth, jobs) {
	const controller = new AbortController();
	inflight.add(controller);
	try {
		const result = await classifyAndPersistTitleReviewBatch(jobs, auth, {
			sessionId: session.id,
			signal: controller.signal,
		});
		session.approved += result.approved;
		session.reviewRequired += result.reviewRequired;
		session.failed += result.failed;
		session.lastBatch = {
			size: jobs.length,
			title: jobs[0]?.title || '',
			finishedAt: new Date().toISOString(),
		};
		if (result.usage) {
			session.inputTokens += result.usage.inputTokens || 0;
			session.outputTokens += result.usage.outputTokens || 0;
			if (typeof result.usage.cost === 'number') session.costUsd += result.usage.cost;
		}
	} catch (error) {
		if (cancelRequested || controller.signal.aborted) {
			await releaseBatch(jobs, session.id);
			return;
		}
		await recordTitleReviewBatchFailure(jobs, session.id, error);
		session.failed += jobs.length;
		console.error(`[job-title-review] batch failed (${jobs.length}): ${error.message}`);
	} finally {
		inflight.delete(controller);
		session.processed += jobs.length;
		session.remaining = Math.max(0, session.total - session.processed);
		invalidateTitleReviewCounts();
	}
}

async function runSession(session) {
	let auth;
	try {
		auth = await resolveExtractionAuth(session.applierName);
	} catch (error) {
		session.running = false;
		session.status = 'failed';
		session.phase = null;
		session.error = error.message;
		return;
	}

	session.provider = auth.providerId;
	session.model = auth.model;

	try {
		session.phase = 'preparing';
		session.queue = await loadPendingQueue();
		session.total = session.queue.length;
		session.remaining = session.total;
		session.phase = 'processing';
		console.log(
			`[job-title-review] starting — ${auth.providerId}/${auth.model}, ` +
			`${TITLE_REVIEW_CONCURRENCY}× batches of ≤${TITLE_REVIEW_BATCH_SIZE}, ${session.total} job(s)`,
		);
		while (!cancelRequested) {
			const batches = [];
			for (let index = 0; index < TITLE_REVIEW_CONCURRENCY; index += 1) {
				const remaining = session.total - session.processed - batches.reduce((sum, batch) => sum + batch.length, 0);
				if (remaining <= 0) break;
				const batch = await claimBatch(session, Math.min(TITLE_REVIEW_BATCH_SIZE, remaining));
				if (!batch.length) break;
				batches.push(batch);
			}
			if (!batches.length) break;
			await Promise.all(batches.map((batch) => processBatch(session, auth, batch)));
		}
	} finally {
		session.phase = 'finalizing';
		await warmTitleReviewReadCache();
		session.running = false;
		session.phase = null;
		session.finishedAt = new Date().toISOString();
		session.status = cancelRequested ? 'cancelled' : 'completed';
		if (!cancelRequested) session.remaining = 0;
		console.log(
			`[job-title-review] ${session.status} — ${session.approved} approved, ` +
			`${session.reviewRequired} review required, ${session.failed} failed · ` +
			`${session.inputTokens + session.outputTokens} tokens · ${formatCostUsd(session.costUsd)}`,
		);
	}
}

function sessionSnapshot() {
	if (!activeSession) return { running: false, status: 'idle' };
	return {
		running: activeSession.running,
		status: activeSession.status,
		phase: activeSession.phase,
		sessionId: activeSession.id,
		total: activeSession.total,
		processed: activeSession.processed,
		approved: activeSession.approved,
		reviewRequired: activeSession.reviewRequired,
		failed: activeSession.failed,
		remaining: activeSession.remaining,
		lastBatch: activeSession.lastBatch,
		startedAt: activeSession.startedAt,
		finishedAt: activeSession.finishedAt,
		error: activeSession.error,
		concurrency: TITLE_REVIEW_CONCURRENCY,
		batchSize: TITLE_REVIEW_BATCH_SIZE,
		provider: activeSession.provider,
		model: activeSession.model,
	};
}

export async function getTitleReviewSessionStatus() {
	return { ...sessionSnapshot(), ...(await getTitleReviewCounts()) };
}

export async function startTitleReviewSession({ applierName } = {}) {
	if (!jobsCollection) throw new Error('Database not ready');
	if (activeSession?.running) throw new Error('Title review session already running');
	const name = String(applierName || '').trim();
	if (!name) throw new Error('applierName is required.');
	await resolveExtractionAuth(name);
	await recoverStaleLeases();
	invalidateTitleReviewCounts();
	const { pending } = await getTitleReviewCounts();
	if (!pending) return { started: false, pending: 0, message: 'No titles are waiting for review.' };

	cancelRequested = false;
	activeSession = {
		id: randomUUID(),
		applierName: name,
		queue: [],
		running: true,
		status: 'running',
		total: pending,
		processed: 0,
		approved: 0,
		reviewRequired: 0,
		failed: 0,
		remaining: pending,
		phase: 'preparing',
		lastBatch: null,
		provider: null,
		model: null,
		inputTokens: 0,
		outputTokens: 0,
		costUsd: 0,
		startedAt: new Date().toISOString(),
		finishedAt: null,
		error: null,
	};
	void runSession(activeSession).catch((error) => {
		console.error('[job-title-review] session error', error);
		if (activeSession) {
			activeSession.running = false;
			activeSession.status = 'failed';
			activeSession.error = error.message;
		}
	});
	return { started: true, sessionId: activeSession.id, pending };
}

export function stopTitleReviewSession() {
	if (!activeSession?.running) return { stopped: false, message: 'No active session' };
	cancelRequested = true;
	for (const controller of inflight) controller.abort();
	return { stopped: true, sessionId: activeSession.id };
}
