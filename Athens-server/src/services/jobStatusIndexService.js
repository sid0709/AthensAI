import { getFirestoreDb } from './firebase/firebaseAdmin.js';
import { statusRowFromProjection } from './jobStatusProjectionService.js';

const STATUS_COLLECTION = 'job_statuses';
const MAX_PROFILE_INDEXES = Math.max(1, Number(process.env.JOB_STATUS_INDEX_MAX_PROFILES || 20));
const IDLE_MS = Math.max(60_000, Number(process.env.JOB_STATUS_INDEX_IDLE_MS || 10 * 60_000));
const indexes = new Map();

function normalizedProjection(raw = {}) {
	const row = statusRowFromProjection(raw);
	if (!row) return null;
	return {
		jobId: String(raw.jobId || ''),
		state: String(raw.state || ''),
		visibleInJobSearch: raw.visibleInJobSearch === true,
		postedAt: raw.postedAt || null,
		row,
	};
}

function removeEntry(profileId) {
	const entry = indexes.get(profileId);
	if (!entry) return;
	entry.unsubscribe?.();
	indexes.delete(profileId);
}

function evictIdle(now = Date.now()) {
	for (const [profileId, entry] of indexes) {
		if (entry.lastAccess + IDLE_MS < now) removeEntry(profileId);
	}
	while (indexes.size >= MAX_PROFILE_INDEXES) {
		const oldest = [...indexes.entries()].sort((left, right) => left[1].lastAccess - right[1].lastAccess)[0];
		if (!oldest) break;
		removeEntry(oldest[0]);
	}
}

function createEntry(profileId) {
	let settleReady;
	let rejectReady;
	const ready = new Promise((resolve, reject) => {
		settleReady = resolve;
		rejectReady = reject;
	});
	const entry = {
		profileId,
		lastAccess: Date.now(),
		rows: new Map(),
		statusJobIds: new Set(),
		ready,
		settled: false,
		unsubscribe: null,
	};
	const query = getFirestoreDb().collection(STATUS_COLLECTION).where('profileId', '==', profileId);
	entry.unsubscribe = query.onSnapshot((snapshot) => {
		for (const change of snapshot.docChanges()) {
			const previous = entry.rows.get(change.doc.id);
			if (previous?.jobId) entry.statusJobIds.delete(previous.jobId);
			if (change.type === 'removed') {
				entry.rows.delete(change.doc.id);
				continue;
			}
			const projection = normalizedProjection(change.doc.data());
			if (!projection?.jobId) {
				entry.rows.delete(change.doc.id);
				continue;
			}
			entry.rows.set(change.doc.id, projection);
			entry.statusJobIds.add(projection.jobId);
		}
		if (!entry.settled) {
			entry.settled = true;
			settleReady(entry);
		}
	}, (error) => {
		if (!entry.settled) {
			entry.settled = true;
			rejectReady(error);
		}
		removeEntry(profileId);
	});
	return entry;
}

/**
 * A bounded process-local anti-join index. Its first value is delivered by the
 * Firestore listener itself, so a cold request cannot silently use an empty set.
 */
export async function getProfileJobStatusIndex(profileIdRaw) {
	const profileId = String(profileIdRaw || '').trim();
	if (!profileId) throw Object.assign(new Error('A profile is required for the New tab'), { status: 400 });
	evictIdle();
	let entry = indexes.get(profileId);
	if (!entry) {
		entry = createEntry(profileId);
		indexes.set(profileId, entry);
	}
	entry.lastAccess = Date.now();
	try {
		await entry.ready;
	} catch (error) {
		throw Object.assign(new Error(`Job status state is temporarily unavailable: ${error?.message || error}`), {
			status: 503,
			retryable: true,
		});
	}
	return entry;
}

export function invalidateProfileJobStatusIndex(profileIdRaw) {
	const profileId = String(profileIdRaw || '').trim();
	if (profileId) removeEntry(profileId);
}

export function closeJobStatusIndexes() {
	for (const profileId of [...indexes.keys()]) removeEntry(profileId);
}
