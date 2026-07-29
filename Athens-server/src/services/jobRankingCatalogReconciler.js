import { getDataStore } from '../db/dataStore.js';
import { getRedis, isRedisReady } from '../db/redis.js';
import { removeJobsFromRanking } from './matching/jobRankingIndex.js';

const DEFAULT_BATCH_SIZE = 500;
const DEFAULT_CONCURRENCY = 4;
const LOCK_TTL_SECONDS = 5 * 60;

function canonicalCatalog(value) {
	return String(value || 'market').trim().toLowerCase() === 'external'
		? 'external'
		: 'market';
}

function uniqueEntries(entries = []) {
	const byId = new Map();
	for (const entry of entries) {
		const id = String(entry?.id || entry?.jobId || '').trim();
		if (!id) continue;
		byId.set(id, { id, catalog: canonicalCatalog(entry?.catalog) });
	}
	return [...byId.values()];
}

async function acquireReconciliationLock(revision) {
	if (!isRedisReady()) return true;
	const key = `jobs:list:v2:catalog-reconcile:${String(revision || 'unknown')}`;
	return Boolean(await getRedis().set(key, String(process.pid), {
		NX: true,
		EX: LOCK_TTL_SECONDS,
	}));
}

/**
 * Remove ranking entries whose authoritative Firestore job is missing or now
 * belongs to a different catalog. The page payload cache is deliberately not
 * trusted here: deleted jobs can otherwise remain clickable indefinitely.
 */
export async function reconcileIndexedJobCatalog(entries = [], {
	revision = 'unknown',
	firestore = getDataStore()?.firestore,
	removeRanking = removeJobsFromRanking,
	onStale = () => {},
	batchSize = DEFAULT_BATCH_SIZE,
	concurrency = DEFAULT_CONCURRENCY,
	acquireLock = true,
} = {}) {
	const indexed = uniqueEntries(entries);
	if (!indexed.length) return { scanned: 0, removed: 0 };
	if (!firestore) return { scanned: 0, removed: 0, skipped: 'database-unavailable' };
	if (acquireLock && !(await acquireReconciliationLock(revision))) {
		return { scanned: 0, removed: 0, skipped: 'already-running' };
	}

	const size = Math.max(1, Math.min(1_000, Number(batchSize) || DEFAULT_BATCH_SIZE));
	const batches = [];
	for (let offset = 0; offset < indexed.length; offset += size) {
		batches.push(indexed.slice(offset, offset + size));
	}

	const staleIds = [];
	let nextBatch = 0;
	async function worker() {
		for (;;) {
			const batchIndex = nextBatch;
			nextBatch += 1;
			if (batchIndex >= batches.length) return;
			const batch = batches[batchIndex];
			const refs = batch.map(({ id }) => firestore.collection('jobs').doc(id));
			const snapshots = await firestore.getAll(...refs, { fieldMask: ['sourceCatalog'] });
			const staleBatch = [];
			for (let index = 0; index < batch.length; index += 1) {
				const snapshot = snapshots[index];
				const authoritativeCatalog = snapshot?.exists
					? canonicalCatalog(snapshot.data()?.sourceCatalog)
					: null;
				if (!snapshot?.exists || authoritativeCatalog !== batch[index].catalog) {
					staleBatch.push(batch[index].id);
				}
			}
			if (staleBatch.length) {
				staleIds.push(...staleBatch);
				onStale(staleBatch);
			}
		}
	}

	const workerCount = Math.max(1, Math.min(
		batches.length,
		Number(concurrency) || DEFAULT_CONCURRENCY,
	));
	await Promise.all(Array.from({ length: workerCount }, () => worker()));
	if (staleIds.length) await removeRanking(staleIds);
	return { scanned: indexed.length, removed: staleIds.length, staleIds };
}

export const jobRankingCatalogReconcilerTest = {
	canonicalCatalog,
	uniqueEntries,
};
