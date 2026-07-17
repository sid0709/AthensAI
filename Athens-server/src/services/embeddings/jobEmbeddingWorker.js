/**
 * Background session to embed jobs missing vector index entries.
 * Triggered from Job Search "Start embedding" button.
 */
import { randomUUID } from 'crypto';
import { jobsCollection } from '../../db/mongo.js';
import { initQdrantCollections, isQdrantReady } from '../vectorStore/qdrantClient.js';
import { upsertJobEmbedding } from './embeddingIngest.js';

let activeSession = null;
let cancelRequested = false;

/** Jobs that were never successfully embedded (Qdrant down on ingest, etc.). */
export const MISSING_EMBEDDING_QUERY = { embedding: { $exists: false } };

export async function countMissingJobEmbeddings() {
	if (!jobsCollection) return 0;
	return jobsCollection.countDocuments(MISSING_EMBEDDING_QUERY);
}

async function runSessionLoop(session) {
	const cursor = jobsCollection.find(MISSING_EMBEDDING_QUERY, {
		projection: { _id: 1, title: 1 },
	});

	try {
		for await (const job of cursor) {
			if (cancelRequested) break;
			if (session.limit != null && session.processed >= session.limit) break;

			const jobId = String(job._id);
			try {
				const result = await upsertJobEmbedding(jobId);
				if (result.ok) {
					session.embedded += 1;
					session.lastJob = { id: jobId, title: job.title || '' };
				} else {
					session.skipped += 1;
					session.lastSkipReason = result.reason || 'unknown';
				}
			} catch (err) {
				console.error('[job-embedding] failed', jobId, err.message);
				session.failed += 1;
			}
			session.processed += 1;
			session.remaining = Math.max(0, session.total - session.processed);
		}
	} finally {
		session.running = false;
		session.finishedAt = new Date().toISOString();
		session.status = cancelRequested ? 'cancelled' : 'completed';
		session.remaining = await countMissingJobEmbeddings();
	}
}

export function getJobEmbeddingSessionStatus() {
	if (!activeSession) {
		return { running: false, status: 'idle' };
	}
	return {
		running: activeSession.running,
		status: activeSession.status,
		sessionId: activeSession.id,
		total: activeSession.total,
		processed: activeSession.processed,
		embedded: activeSession.embedded,
		skipped: activeSession.skipped,
		failed: activeSession.failed,
		remaining: activeSession.remaining,
		lastJob: activeSession.lastJob ?? null,
		lastSkipReason: activeSession.lastSkipReason ?? null,
		startedAt: activeSession.startedAt,
		finishedAt: activeSession.finishedAt ?? null,
		error: activeSession.error ?? null,
	};
}

export async function getJobEmbeddingStatus() {
	const missing = await countMissingJobEmbeddings();
	const session = getJobEmbeddingSessionStatus();
	return { missing, ...session };
}

export async function startJobEmbeddingSession({ limit = null } = {}) {
	if (!jobsCollection) throw new Error('Database not ready');

	if (activeSession?.running) {
		throw new Error('Job embedding session already running');
	}

	if (!isQdrantReady()) {
		const ok = await initQdrantCollections();
		if (!ok) {
			throw new Error('Qdrant is not reachable. Start it with `npm run qdrant:start` in Athens-server.');
		}
	}

	const missing = await countMissingJobEmbeddings();
	if (missing === 0) {
		return { sessionId: null, missing: 0, started: false, message: 'All jobs are already embedded' };
	}

	cancelRequested = false;
	activeSession = {
		id: randomUUID(),
		running: true,
		status: 'running',
		total: limit != null ? Math.min(missing, Number(limit)) : missing,
		processed: 0,
		embedded: 0,
		skipped: 0,
		failed: 0,
		remaining: missing,
		limit: limit != null ? Number(limit) : null,
		lastJob: null,
		lastSkipReason: null,
		startedAt: new Date().toISOString(),
		finishedAt: null,
	};

	void runSessionLoop(activeSession).catch((err) => {
		console.error('[job-embedding] session error', err);
		if (activeSession) {
			activeSession.running = false;
			activeSession.status = 'failed';
			activeSession.error = err.message;
		}
	});

	return {
		sessionId: activeSession.id,
		missing,
		started: true,
	};
}

export function stopJobEmbeddingSession() {
	if (!activeSession?.running) {
		return { stopped: false, message: 'No active session' };
	}
	cancelRequested = true;
	return { stopped: true, sessionId: activeSession.id };
}
