/**
 * Manual, high-throughput AI title-classification session for New (unapplied) jobs.
 * Batches many titles per LLM call and runs multiple batches in parallel.
 */
import { randomUUID } from 'crypto';
import { TITLE_SCAN_ROLES } from '../../config/jobTitleScanRoles.js';
import { jobsCollection } from '../../db/dataStore.js';
import { getRedis, isRedisReady } from '../../db/redis.js';
import { getFirestoreDb } from '../firebase/firebaseAdmin.js';
import { formatCostUsd } from '../llm/llmService.js';
import { findAccountByApplierName } from '../mail/credentials.js';
import {
	TITLE_SCAN_BATCH_SIZE,
	classifyAndPersistTitleBatch,
	recordTitleScanFailure,
	resolveExtractionAuth,
} from './titleScanService.js';

/** Parallel LLM batch calls (each batch classifies TITLE_SCAN_BATCH_SIZE titles). */
const CONCURRENCY = Math.max(1, Number(process.env.JOB_TITLE_SCAN_CONCURRENCY || 12));

const CLAIM_PROJECTION = { title: 1, postedAt: 1, status: 1 };

let activeSession = null;
let cancelRequested = false;
const inflight = new Set();
const pendingCountCache = new Map();
const PENDING_COUNT_CACHE_MS = Math.max(
	5_000,
	Number(process.env.JOB_TITLE_PENDING_COUNT_CACHE_MS || 30_000),
);
const PENDING_COUNT_CACHE_SEC = Math.max(5, Math.ceil(PENDING_COUNT_CACHE_MS / 1_000));

function unscannedMatch() {
	return {
		$and: [
			{
				$or: [
					{ titleScanned: { $exists: false } },
					{ titleScanned: null },
					{ titleScanned: '' },
				],
			},
			{ titleScanStatus: { $ne: 'scanning' } },
		],
	};
}

/** New tab = no status entry for this applier (same semantics as job list "posted"). */
function newJobsMatch(applierId) {
	if (!applierId) {
		return { $or: [{ status: { $exists: false } }, { status: { $size: 0 } }] };
	}
	return {
		$or: [
			{ status: { $exists: false } },
			{ status: { $not: { $elemMatch: { applier: applierId } } } },
		],
	};
}

export function pendingTitleAnalysisQuery(applierId) {
	return { $and: [unscannedMatch(), newJobsMatch(applierId)] };
}

function titleIsUnprocessed(job) {
	return job?.titleScanned == null || String(job.titleScanned).trim() === '';
}

async function countUnprocessedStatusJobs(applierId) {
	if (!applierId) return 0;
	const db = getFirestoreDb();
	const statusSnapshot = await db.collection('job_statuses')
		.where('profileId', '==', String(applierId))
		.select('jobId')
		.get();
	const jobIds = [...new Set(statusSnapshot.docs
		.map((snapshot) => String(snapshot.data()?.jobId || ''))
		.filter(Boolean))];
	if (!jobIds.length) return 0;
	let count = 0;
	for (let offset = 0; offset < jobIds.length; offset += 400) {
		const refs = jobIds
			.slice(offset, offset + 400)
			.map((jobId) => db.collection('jobs').doc(String(jobId)));
		const snapshots = await db.getAll(...refs, {
			fieldMask: ['sourceCatalog', 'titleScanned', 'titleScanStatus'],
		});
		count += snapshots.filter((snapshot) => {
			if (!snapshot.exists) return false;
			const job = snapshot.data();
			return job?.sourceCatalog === 'market'
				&& job?.titleScanStatus !== 'scanning'
				&& titleIsUnprocessed(job);
		}).length;
	}
	return count;
}

async function countPendingTitleAnalysisNative(applierId) {
	const market = getFirestoreDb().collection('jobs').where('sourceCatalog', '==', 'market');
	const [totalSnapshot, processedSnapshot, scanningSnapshot, excluded] = await Promise.all([
		market.count().get(),
		market.where('titleScanned', 'in', TITLE_SCAN_ROLES).count().get(),
		market.where('titleScanStatus', '==', 'scanning').count().get(),
		countUnprocessedStatusJobs(applierId),
	]);
	const total = totalSnapshot.data().count;
	const processed = processedSnapshot.data().count;
	const scanning = scanningSnapshot.data().count;
	return Math.max(0, total - processed - scanning - excluded);
}

export async function countPendingTitleAnalysis(applierId, { force = false } = {}) {
	if (!jobsCollection) return null;
	const key = String(applierId || 'unassigned');
	const cached = pendingCountCache.get(key);
	if (!force && cached?.expiresAt > Date.now()) return cached.promise;
	const redisKey = `jobs:analysis:title-pending:v1:${key}`;
	if (!force && isRedisReady()) {
		const stored = await getRedis().get(redisKey).catch(() => null);
		const count = stored == null ? NaN : Number(stored);
		if (Number.isFinite(count) && count >= 0) {
			const promise = Promise.resolve(count);
			pendingCountCache.set(key, {
				promise,
				expiresAt: Date.now() + PENDING_COUNT_CACHE_MS,
			});
			return promise;
		}
	}
	const promise = countPendingTitleAnalysisNative(applierId)
		.catch((error) => {
			if (Number(error?.code) === 9) {
				// Keep the badge available while a declared aggregate index is building.
				return jobsCollection
					.find(pendingTitleAnalysisQuery(applierId), { projection: { _id: 1 } })
					.toArray()
					.then((jobs) => jobs.length);
			}
			pendingCountCache.delete(key);
			throw error;
		})
		.then((count) => {
			if (isRedisReady()) {
				void getRedis().setEx(redisKey, PENDING_COUNT_CACHE_SEC, String(count)).catch(() => undefined);
			}
			return count;
		});
	pendingCountCache.set(key, {
		promise,
		expiresAt: Date.now() + PENDING_COUNT_CACHE_MS,
	});
	return promise;
}

function invalidatePendingTitleAnalysisCount(applierId) {
	const key = String(applierId || 'unassigned');
	pendingCountCache.delete(key);
	if (isRedisReady()) {
		void getRedis().del(`jobs:analysis:title-pending:v1:${key}`).catch(() => undefined);
	}
}

async function resolveApplierId(applierName) {
	const name = String(applierName || '').trim();
	if (!name) return null;
	const doc = await findAccountByApplierName(name);
	return doc?._id || null;
}

async function claimBatch(applierId, n) {
	if (!jobsCollection || n <= 0) return [];
	const jobs = await jobsCollection
		.find(pendingTitleAnalysisQuery(applierId))
		.project(CLAIM_PROJECTION)
		.sort({ postedAt: -1 })
		.limit(n)
		.toArray();
	if (!jobs.length) return [];

	await jobsCollection.updateMany(
		{
			_id: { $in: jobs.map((j) => j._id) },
			...unscannedMatch(),
		},
		{ $set: { titleScanStatus: 'scanning' } },
	);
	return jobs;
}

async function requeue(jobs) {
	if (!jobsCollection || !jobs?.length) return;
	await jobsCollection
		.updateMany(
			{ _id: { $in: jobs.map((j) => j._id) }, titleScanStatus: 'scanning' },
			{ $unset: { titleScanStatus: '' } },
		)
		.catch(() => {});
}

async function processBatch(session, auth, jobs) {
	const controller = new AbortController();
	inflight.add(controller);
	try {
		const result = await classifyAndPersistTitleBatch(jobs, auth, {
			signal: controller.signal,
		});
		session.classified += result.classified;
		const sampleId = jobs[0] ? String(jobs[0]._id) : null;
		session.lastJob = {
			id: sampleId,
			title: jobs[0]?.title || '',
			role: sampleId ? result.roles?.[sampleId] : null,
			batchSize: jobs.length,
		};
		if (result.usage) {
			session.inputTokens += result.usage.inputTokens || 0;
			session.outputTokens += result.usage.outputTokens || 0;
			if (typeof result.usage.cost === 'number') session.costUsd += result.usage.cost;
		}
	} catch (err) {
		if (cancelRequested || controller.signal.aborted) {
			await requeue(jobs);
			return;
		}
		await recordTitleScanFailure(jobs, err);
		session.failed += jobs.length;
		console.error(`[job-title-scan] batch failed (${jobs.length}): ${err.message}`);
	} finally {
		inflight.delete(controller);
		session.processed += jobs.length;
		session.remaining = session.total == null
			? null
			: Math.max(0, session.total - session.processed);
	}
}

async function recoverStuckScanning() {
	await jobsCollection
		?.updateMany({ titleScanStatus: 'scanning' }, { $unset: { titleScanStatus: '' } })
		.catch(() => {});
}

async function runSession(session) {
	let auth;
	try {
		auth = await resolveExtractionAuth(session.applierName);
	} catch (err) {
		session.running = false;
		session.status = 'failed';
		session.error = err.message;
		return;
	}

	session.provider = auth.providerId;
	session.model = auth.model;
	console.log(
		`[job-title-scan] starting — ${auth.providerId}/${auth.model}, ` +
			`${CONCURRENCY}× batches of ≤${TITLE_SCAN_BATCH_SIZE}, ${session.total} job(s)`,
	);

	try {
		while (!cancelRequested) {
			const slots = [];
			for (let i = 0; i < CONCURRENCY; i++) {
				let take = TITLE_SCAN_BATCH_SIZE;
				if (session.limit != null) {
					const left = session.limit - session.processed - slots.reduce((n, b) => n + b.length, 0);
					take = Math.min(take, left);
					if (take <= 0) break;
				}
				const batch = await claimBatch(session.applierId, take);
				if (!batch.length) break;
				slots.push(batch);
			}
			if (!slots.length) break;
			await Promise.all(slots.map((batch) => processBatch(session, auth, batch)));
		}
	} finally {
		session.running = false;
		session.finishedAt = new Date().toISOString();
		session.status = cancelRequested ? 'cancelled' : 'completed';
		session.remaining = cancelRequested ? null : 0;
		invalidatePendingTitleAnalysisCount(session.applierId);
		console.log(
			`[job-title-scan] ${session.status} — ${session.classified} classified, ${session.failed} failed · ` +
				`${session.inputTokens + session.outputTokens} tokens · ${formatCostUsd(session.costUsd)}`,
		);
	}
}

export function getTitleScanStatus() {
	if (!activeSession) return { running: false, status: 'idle' };
	return {
		running: activeSession.running,
		status: activeSession.status,
		sessionId: activeSession.id,
		total: activeSession.total,
		processed: activeSession.processed,
		classified: activeSession.classified,
		failed: activeSession.failed,
		remaining: activeSession.remaining,
		lastJob: activeSession.lastJob ?? null,
		startedAt: activeSession.startedAt,
		finishedAt: activeSession.finishedAt ?? null,
		error: activeSession.error ?? null,
		concurrency: CONCURRENCY,
		batchSize: TITLE_SCAN_BATCH_SIZE,
		provider: activeSession.provider ?? null,
		model: activeSession.model ?? null,
		inputTokens: activeSession.inputTokens,
		outputTokens: activeSession.outputTokens,
		costUsd: activeSession.costUsd,
	};
}

export async function getTitleScanSessionStatus(applierName) {
	const status = getTitleScanStatus();
	const sameApplier = activeSession?.applierName === String(applierName || '').trim();
	if (sameApplier && activeSession?.running) {
		const pending = activeSession.remaining ?? null;
		return { ...status, pending, pendingKnown: pending != null };
	}
	const applierId = await resolveApplierId(applierName);
	const pending = await countPendingTitleAnalysis(applierId);
	return { ...status, pending, pendingKnown: pending != null };
}

export async function startTitleScanSession({ applierName, limit = null } = {}) {
	if (!jobsCollection) throw new Error('Database not ready');
	if (activeSession?.running) throw new Error('Title scan session already running');

	const name = String(applierName || '').trim();
	if (!name) throw new Error('No applier specified — cannot resolve an AI API key for title scan.');

	await resolveExtractionAuth(name);
	await recoverStuckScanning();

	const applierId = await resolveApplierId(name);
	const parsedLimit = limit != null ? Math.max(1, Number(limit) || 1) : null;

	cancelRequested = false;
	activeSession = {
		id: randomUUID(),
		applierName: name,
		applierId,
		running: true,
		status: 'running',
		total: parsedLimit,
		limit: parsedLimit,
		processed: 0,
		classified: 0,
		failed: 0,
		remaining: parsedLimit,
		lastJob: null,
		provider: null,
		model: null,
		inputTokens: 0,
		outputTokens: 0,
		costUsd: 0,
		startedAt: new Date().toISOString(),
		finishedAt: null,
	};
	invalidatePendingTitleAnalysisCount(applierId);

	void runSession(activeSession).catch((err) => {
		console.error('[job-title-scan] session error', err);
		if (activeSession) {
			activeSession.running = false;
			activeSession.status = 'failed';
			activeSession.error = err.message;
		}
	});

	return {
		sessionId: activeSession.id,
		pending: null,
		started: true,
	};
}

export function stopTitleScanSession() {
	if (!activeSession?.running) return { stopped: false, message: 'No active session' };
	cancelRequested = true;
	for (const controller of inflight) controller.abort();
	return { stopped: true, sessionId: activeSession.id };
}
