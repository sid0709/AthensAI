/**
 * Manual, high-throughput AI title-classification session for New (unapplied) jobs.
 * Batches many titles per LLM call and runs multiple batches in parallel.
 */
import { randomUUID } from 'crypto';
import { jobsCollection, accountInfoCollection } from '../../db/mongo.js';
import { formatCostUsd } from '../llm/llmService.js';
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

function pendingQuery(applierId) {
	return { $and: [unscannedMatch(), newJobsMatch(applierId)] };
}

async function resolveApplierId(applierName) {
	const name = String(applierName || '').trim();
	if (!name || !accountInfoCollection) return null;
	const doc = await accountInfoCollection.findOne({ name }, { projection: { _id: 1 } });
	return doc?._id || null;
}

export async function countPendingTitleScan(applierName) {
	if (!jobsCollection) return 0;
	const applierId = await resolveApplierId(applierName);
	return jobsCollection.countDocuments(pendingQuery(applierId));
}

async function claimBatch(applierId, n) {
	if (!jobsCollection || n <= 0) return [];
	const jobs = await jobsCollection
		.find(pendingQuery(applierId))
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
		session.remaining = Math.max(0, session.total - session.processed);
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
		session.remaining = await countPendingTitleScan(session.applierName);
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
	const pending = await countPendingTitleScan(applierName);
	return { pending, ...getTitleScanStatus() };
}

export async function startTitleScanSession({ applierName, limit = null } = {}) {
	if (!jobsCollection) throw new Error('Database not ready');
	if (activeSession?.running) throw new Error('Title scan session already running');

	const name = String(applierName || '').trim();
	if (!name) throw new Error('No applier specified — cannot resolve an AI API key for title scan.');

	await resolveExtractionAuth(name);
	await recoverStuckScanning();

	const applierId = await resolveApplierId(name);
	const pending = await countPendingTitleScan(name);
	if (pending === 0) {
		return {
			sessionId: null,
			pending: 0,
			started: false,
			message: 'No New jobs pending title analysis',
		};
	}

	cancelRequested = false;
	activeSession = {
		id: randomUUID(),
		applierName: name,
		applierId,
		running: true,
		status: 'running',
		total: limit != null ? Math.min(pending, Number(limit)) : pending,
		limit: limit != null ? Number(limit) : null,
		processed: 0,
		classified: 0,
		failed: 0,
		remaining: pending,
		lastJob: null,
		provider: null,
		model: null,
		inputTokens: 0,
		outputTokens: 0,
		costUsd: 0,
		startedAt: new Date().toISOString(),
		finishedAt: null,
	};

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
		pending,
		started: true,
	};
}

export function stopTitleScanSession() {
	if (!activeSession?.running) return { stopped: false, message: 'No active session' };
	cancelRequested = true;
	for (const controller of inflight) controller.abort();
	return { stopped: true, sessionId: activeSession.id };
}
