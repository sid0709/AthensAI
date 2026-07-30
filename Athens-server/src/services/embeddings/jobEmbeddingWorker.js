/** Durable worker runner for jobs missing vector index entries. */
import { jobsCollection } from '../../db/dataStore.js';
import { mapPool } from '../../utils/concurrency.js';
import { initQdrantCollections, isQdrantReady } from '../vectorStore/qdrantClient.js';
import { upsertJobEmbedding } from './embeddingIngest.js';

const INDEX_CONCURRENCY = Math.max(
	1,
	Math.min(8, Number.parseInt(String(process.env.BACKGROUND_INDEX_CONCURRENCY || ''), 10) || 8),
);
const MAX_ITEMS = Math.max(
	1,
	Number.parseInt(String(process.env.BACKGROUND_TASK_MAX_ITEMS || ''), 10) || 2_000,
);

/** Jobs that were never successfully embedded (Qdrant down on ingest, etc.). */
export const MISSING_EMBEDDING_QUERY = { embedding: { $exists: false } };

function throwIfAborted(signal) {
	if (!signal?.aborted) return;
	throw signal.reason instanceof Error
		? signal.reason
		: Object.assign(new Error('Job embedding cancelled'), { name: 'AbortError' });
}

export async function countMissingJobEmbeddings() {
	if (!jobsCollection) return 0;
	return jobsCollection.countDocuments(MISSING_EMBEDDING_QUERY);
}

export async function runJobEmbeddingTask({ limit = null, signal, onProgress } = {}) {
	if (!jobsCollection) throw new Error('Database not ready');
	if (!isQdrantReady()) {
		const ready = await initQdrantCollections();
		if (!ready) throw new Error('Qdrant is not reachable');
	}
	throwIfAborted(signal);
	const missing = await countMissingJobEmbeddings();
	const requested = limit == null
		? Math.min(missing, MAX_ITEMS)
		: Math.min(missing, MAX_ITEMS, Math.max(1, Math.floor(Number(limit) || 1)));
	const jobs = requested > 0
		? await jobsCollection.find(MISSING_EMBEDDING_QUERY, {
			projection: { _id: 1, title: 1 },
		}).limit(requested).toArray()
		: [];
	const session = {
		total: jobs.length,
		processed: 0,
		embedded: 0,
		skipped: 0,
		failed: 0,
		cancelled: 0,
		active: 0,
		remaining: jobs.length,
		lastJob: null,
		lastSkipReason: null,
		phase: 'embedding',
	};
	const report = () => onProgress?.({ ...session });
	await report();
	await mapPool(jobs, INDEX_CONCURRENCY, async (job) => {
		if (signal?.aborted) {
			session.cancelled += 1;
			session.processed += 1;
			session.remaining = Math.max(0, session.total - session.processed);
			await report();
			return;
		}
		session.active += 1;
		await report();
		try {
			const result = await upsertJobEmbedding(String(job._id), { signal });
			throwIfAborted(signal);
			if (result.ok) {
				session.embedded += 1;
				session.lastJob = { id: String(job._id), title: job.title || '' };
			} else {
				session.skipped += 1;
				session.lastSkipReason = result.reason || 'unknown';
			}
		} catch (error) {
			if (signal?.aborted || error?.name === 'AbortError') session.cancelled += 1;
			else {
				session.failed += 1;
				session.lastSkipReason = error?.message || String(error);
			}
		} finally {
			session.active = Math.max(0, session.active - 1);
			session.processed += 1;
			session.remaining = Math.max(0, session.total - session.processed);
			await report();
		}
	});
	session.phase = signal?.aborted ? 'cancelled' : 'completed';
	await report();
	return session;
}
