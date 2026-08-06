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
import { getTitleReviewCountsNative } from './titleReviewQueryService.js';
import {
	getCachedTitleReviewCounts,
	markTitleReviewReadModelChanged,
	scheduleTitleReviewReadModelRebuild,
} from './titleReviewReadModel.js';
import { firestoreMutationLimiter } from '../backgroundTasks/resourceLimits.js';
import { runWithoutBackgroundTaskContext } from '../backgroundTasks/taskContext.js';

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

let countsCache = null;
const COUNTS_CACHE_MS = 2_000;

export function invalidateTitleReviewCounts() {
	countsCache = null;
}

export function pendingTitleReviewQuery() {
	return { 'titleReview.processingState': { $in: ['pending', 'scanning'] } };
}

export async function getTitleReviewCounts() {
	if (!jobsCollection) return {
		pending: null,
		unreviewedCount: null,
		reviewRequiredCount: null,
		failedCount: null,
	};
	if (countsCache?.expiresAt > Date.now()) return countsCache.promise;
	const promise = getCachedTitleReviewCounts()
		.then((cached) => cached || getTitleReviewCountsNative());
	countsCache = { promise, expiresAt: Date.now() + COUNTS_CACHE_MS };
	promise.catch(() => {
		if (countsCache?.promise === promise) countsCache = null;
	});
	return promise;
}

/** Schedule cache construction without making callers wait for Firestore scans. */
export function warmTitleReviewReadCache() {
	scheduleTitleReviewReadModelRebuild({ delayMs: 0 });
	return { warming: true };
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
		const result = await firestoreMutationLimiter.run(() => jobsCollection.bulkWrite(stale.map((job) => ({
			updateOne: {
				filter: { _id: job._id, 'titleReview.processingState': 'scanning' },
				update: {
					$set: { 'titleReview.processingState': 'pending' },
					$unset: { 'titleReview.lease': '', 'titleReview.error': '' },
				},
			},
		})), { ordered: false }));
		recovered += result.modifiedCount || 0;
		if (stale.length < 1_000) break;
	}
	if (recovered) {
		invalidateTitleReviewCounts();
		await markTitleReviewReadModelChanged({ rebuild: false });
	}
	return recovered;
}

async function releaseSessionLeases(sessionId) {
	if (!jobsCollection || !sessionId) return 0;
	const leased = await jobsCollection.find({
		'titleReview.processingState': 'scanning',
		'titleReview.lease.sessionId': sessionId,
	}, { projection: { _id: 1 } }).limit(2_000).toArray();
	if (!leased.length) return 0;
	const result = await firestoreMutationLimiter.run(() => jobsCollection.bulkWrite(leased.map((job) => ({
		updateOne: {
			filter: { _id: job._id, 'titleReview.lease.sessionId': sessionId },
			update: {
				$set: { 'titleReview.processingState': 'pending' },
				$unset: { 'titleReview.lease': '', 'titleReview.error': '' },
			},
		},
	})), { ordered: false }));
	return result.modifiedCount || 0;
}

export async function releaseTitleReviewTaskLeases(taskId) {
	const released = await releaseSessionLeases(String(taskId || ''));
	if (released) {
		invalidateTitleReviewCounts();
		await markTitleReviewReadModelChanged({ rebuild: false });
		scheduleTitleReviewReadModelRebuild({ delayMs: 0 });
	}
	return released;
}

function throwIfCancelled(signal) {
	if (!signal?.aborted) return;
	throw signal.reason instanceof Error
		? signal.reason
		: Object.assign(new Error('Title review cancelled'), { name: 'AbortError' });
}

/**
 * Claim the next pending titles directly from the indexed query.
 * Preloading the entire queue blocked the UI in "Preparing… 0/0" for large
 * Firestore catalogs; skill extraction already claims in waves for the same reason.
 * Only `pending` rows are claimed — `scanning` leases are recovered separately.
 */
async function claimBatch(session, limit, signal) {
	if (!jobsCollection || limit <= 0) return [];
	throwIfCancelled(signal);
	const claimQuery = { 'titleReview.processingState': 'pending' };
	const candidates = await jobsCollection
		.find(claimQuery)
		.project(CLAIM_PROJECTION)
		.limit(limit * 4)
		.toArray();
	throwIfCancelled(signal);
	if (!candidates.length) return [];

	const slice = candidates.slice(0, limit);
	const claimedAt = new Date().toISOString();
	const claimedIds = await firestoreMutationLimiter.run(async () => {
		throwIfCancelled(signal);
		return jobsCollection.atomicClaimMany(
			slice.map((job) => job._id),
			claimQuery,
			{
				$set: {
					'titleReview.processingState': 'scanning',
					'titleReview.lease.sessionId': session.id,
					'titleReview.lease.claimedAt': claimedAt,
				},
			},
		);
	});
	const claimed = new Set(claimedIds.map(String));
	return slice.filter((job) => claimed.has(String(job._id)));
}

async function releaseBatch(jobs, sessionId) {
	if (!jobsCollection || !jobs?.length) return;
	await runWithoutBackgroundTaskContext(() => firestoreMutationLimiter.run(() =>
		jobsCollection.bulkWrite(jobs.map((job) => ({
			updateOne: {
				filter: { _id: job._id, 'titleReview.lease.sessionId': sessionId },
				update: {
					$set: { 'titleReview.processingState': 'pending' },
					$unset: { 'titleReview.lease': '', 'titleReview.error': '' },
				},
			},
		})), { ordered: false }))).catch(() => undefined);
}

function cancellationRequested(signal) {
	return signal?.aborted === true;
}

function taskSessionSnapshot(session) {
	return {
		running: session.running,
		status: session.status,
		phase: session.phase,
		sessionId: session.id,
		total: session.total,
		processed: session.processed,
		approved: session.approved,
		reviewRequired: session.reviewRequired,
		failed: session.failed,
		remaining: session.remaining,
		lastBatch: session.lastBatch,
		startedAt: session.startedAt,
		finishedAt: session.finishedAt,
		error: session.error,
		concurrency: TITLE_REVIEW_CONCURRENCY,
		batchSize: TITLE_REVIEW_BATCH_SIZE,
		provider: session.provider,
		model: session.model,
		inputTokens: session.inputTokens,
		outputTokens: session.outputTokens,
		costUsd: session.costUsd,
	};
}

async function processBatch(session, auth, jobs, { signal, onProgress } = {}) {
	const controller = new AbortController();
	const abortFromParent = () => controller.abort(signal?.reason);
	if (signal?.aborted) abortFromParent();
	else signal?.addEventListener('abort', abortFromParent, { once: true });
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
		if (cancellationRequested(signal) || controller.signal.aborted) {
			await releaseBatch(jobs, session.id);
			return;
		}
		await recordTitleReviewBatchFailure(jobs, session.id, error);
		session.failed += jobs.length;
		console.error(`[job-title-review] batch failed (${jobs.length}): ${error.message}`);
	} finally {
		signal?.removeEventListener('abort', abortFromParent);
		session.processed += jobs.length;
		session.remaining = session.total == null
			? null
			: Math.max(0, Number(session.total) - session.processed);
		invalidateTitleReviewCounts();
		await onProgress?.(taskSessionSnapshot(session));
	}
}

/**
 * Publish terminal session state before any derived-cache work begins. The
 * rebuild callback is deliberately invoked without awaiting its result so a
 * slow or unavailable cache can never hold the progress UI in "finalizing".
 */
export function finalizeTitleReviewSession(session, {
	cancelled = false,
	scheduleRebuild = scheduleTitleReviewReadModelRebuild,
	now = () => new Date().toISOString(),
} = {}) {
	session.phase = 'finalizing';
	session.running = false;
	session.finishedAt = now();
	session.status = cancelled ? 'cancelled' : 'completed';
	if (!cancelled) session.remaining = 0;
	session.phase = null;
	scheduleRebuild({ delayMs: 0 });
	return session;
}

async function runSession(session, { signal, onProgress } = {}) {
	let auth;
	try {
		throwIfCancelled(signal);
		auth = await resolveExtractionAuth(session.applierName, { profileId: session.profileId });
		throwIfCancelled(signal);
	} catch (error) {
		session.running = false;
		session.status = cancellationRequested(signal) ? 'cancelled' : 'failed';
		session.phase = null;
		session.error = cancellationRequested(signal) ? null : error.message;
		await onProgress?.(taskSessionSnapshot(session));
		return;
	}

	session.provider = auth.providerId;
	session.model = auth.model;

	try {
		session.phase = 'preparing';
		await onProgress?.(taskSessionSnapshot(session));
		const counts = await getTitleReviewCounts();
		const pending = Number(counts?.pending ?? counts?.unreviewedCount ?? 0);
		if (session.limit != null) {
			session.total = Math.min(session.limit, Math.max(0, pending));
		} else {
			session.total = Number.isFinite(pending) ? pending : null;
		}
		session.remaining = session.total;
		session.phase = 'processing';
		await onProgress?.(taskSessionSnapshot(session));
		console.log(
			`[job-title-review] starting — ${auth.providerId}/${auth.model}, ` +
			`${TITLE_REVIEW_CONCURRENCY}× batches of ≤${TITLE_REVIEW_BATCH_SIZE}, ` +
			`${session.total == null ? 'until the queue is empty' : `${session.total} job(s)`}`,
		);
		while (!cancellationRequested(signal)) {
			const batches = [];
			for (let index = 0; index < TITLE_REVIEW_CONCURRENCY; index += 1) {
				let take = TITLE_REVIEW_BATCH_SIZE;
				if (session.limit != null) {
					const reserved = batches.reduce((sum, batch) => sum + batch.length, 0);
					take = Math.min(take, session.limit - session.processed - reserved);
					if (take <= 0) break;
				}
				const batch = await claimBatch(session, take, signal);
				if (!batch.length) break;
				batches.push(batch);
			}
			if (!batches.length) break;
			await Promise.all(batches.map((batch) => processBatch(session, auth, batch, { signal, onProgress })));
			if (!cancellationRequested(signal)) await markTitleReviewReadModelChanged({ rebuild: false });
		}
	} finally {
		if (!cancellationRequested(signal)) {
			session.total = session.processed;
			session.remaining = 0;
		}
		finalizeTitleReviewSession(session, { cancelled: cancellationRequested(signal) });
		await onProgress?.(taskSessionSnapshot(session));
		console.log(
			`[job-title-review] ${session.status} — ${session.approved} approved, ` +
			`${session.reviewRequired} review required, ${session.failed} failed · ` +
			`${session.inputTokens + session.outputTokens} tokens · ${formatCostUsd(session.costUsd)}`,
		);
	}
}

/** Worker-owned runner. It has no dependency on HTTP-process-local session state. */
export async function runTitleReviewTask({
	taskId,
	applierName,
	profileId,
	limit = null,
	signal,
	onProgress,
} = {}) {
	if (!jobsCollection) throw new Error('Database not ready');
	const name = String(applierName || '').trim();
	if (!name) throw new Error('applierName is required.');
	const id = String(taskId || randomUUID());
	const parsedLimit = limit == null ? null : Math.max(1, Math.floor(Number(limit) || 1));
	await releaseSessionLeases(id);
	await recoverStaleLeases();
	invalidateTitleReviewCounts();
	const session = {
		id,
		applierName: name,
		profileId: String(profileId || '').trim() || null,
		limit: parsedLimit,
		running: true,
		status: 'running',
		total: parsedLimit,
		processed: 0,
		approved: 0,
		reviewRequired: 0,
		failed: 0,
		remaining: parsedLimit,
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
	await onProgress?.(taskSessionSnapshot(session));
	await runSession(session, { signal, onProgress });
	return taskSessionSnapshot(session);
}
