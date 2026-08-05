import { getFirestoreDb } from '../firebase/firebaseAdmin.js';
import { searchJobIds } from '../search/algoliaJobs.js';
import {
	getTitleReviewCountsNative,
	listTitleReviewJobsNative,
	mapTitleReviewDocument,
	normalizeTitleReviewRequest,
} from './titleReviewQueryService.js';

const JOB_COLLECTION = 'jobs';
const METADATA_COLLECTION = 'system_metadata';
const METADATA_ID = 'title_review';
let revisionCache = { value: '1', expiresAt: 0 };

function postedTime(row) {
	return Date.parse(row?.postedAt || 0) || 0;
}

function compareNewest(left, right) {
	return postedTime(right) - postedTime(left) || String(right.id).localeCompare(String(left.id));
}

function compareOldest(left, right) {
	return postedTime(left) - postedTime(right) || String(left.id).localeCompare(String(right.id));
}

function compareConfidence(left, right) {
	return Number(right?.titleReview?.confidence ?? -1) - Number(left?.titleReview?.confidence ?? -1)
		|| compareNewest(left, right);
}

function matchesTab(row, tab) {
	if (tab === 'review_required') return row.titleReview?.label === 'REVIEW_REQUIRED';
	if (tab === 'failed') return row.titleReview?.processingState === 'failed';
	return ['pending', 'scanning'].includes(row.titleReview?.processingState);
}

async function hydrateSearchResults(ids) {
	const db = getFirestoreDb();
	const result = [];
	for (let offset = 0; offset < ids.length; offset += 250) {
		const chunk = ids.slice(offset, offset + 250);
		const snapshots = await db.getAll(...chunk.map((id) => db.collection(JOB_COLLECTION).doc(id)));
		result.push(...snapshots.filter((snapshot) => snapshot.exists).map(mapTitleReviewDocument));
	}
	return result;
}

async function listAlgoliaTitleReview(options) {
	const normalized = normalizeTitleReviewRequest(options);
	const ids = await searchJobIds(normalized.q, 5_000);
	if (!ids) throw new Error('Algolia is required for Title Review text search');
	const query = normalized.q.toLocaleLowerCase();
	let rows = (await hydrateSearchResults(ids))
		.filter((row) => matchesTab(row, normalized.tab))
		.filter((row) => row.title.toLocaleLowerCase().includes(query));
	if (normalized.sort === 'confidence_desc') rows.sort(compareConfidence);
	else if (normalized.sort === 'oldest') rows.sort(compareOldest);
	else rows.sort(compareNewest);
	const total = rows.length;
	const start = (normalized.page - 1) * normalized.limit;
	return {
		data: rows.slice(start, start + normalized.limit),
		pagination: {
			page: normalized.page,
			limit: normalized.limit,
			total,
			totalPages: Math.ceil(total / normalized.limit),
		},
		timings: { firestore: 0, serialization: 0 },
	};
}

export async function getTitleReviewRevision({ force = false } = {}) {
	if (!force && revisionCache.expiresAt > Date.now()) return revisionCache.value;
	const snapshot = await getFirestoreDb().collection(METADATA_COLLECTION).doc(METADATA_ID).get();
	const value = String(Math.max(1, Number(snapshot.data()?.revision || 1)));
	revisionCache = { value, expiresAt: Date.now() + 500 };
	return value;
}

export async function bumpTitleReviewRevision() {
	const db = getFirestoreDb();
	const ref = db.collection(METADATA_COLLECTION).doc(METADATA_ID);
	const revision = await db.runTransaction(async (transaction) => {
		const snapshot = await transaction.get(ref);
		const next = Math.max(1, Number(snapshot.data()?.revision || 1)) + 1;
		transaction.set(ref, { revision: next, updatedAt: new Date() }, { merge: true });
		return next;
	});
	revisionCache = { value: String(revision), expiresAt: Date.now() + 500 };
	return String(revision);
}

/** Firestore is authoritative; Algolia is used only to obtain text-search candidates. */
export async function listTitleReviewReadModel(options = {}) {
	const normalized = normalizeTitleReviewRequest(options);
	const startedAt = performance.now();
	const [listed, counts, revision] = await Promise.all([
		normalized.q
			? listAlgoliaTitleReview(normalized)
			: listTitleReviewJobsNative(normalized, { includeCount: true }),
		getTitleReviewCountsNative(),
		getTitleReviewRevision(),
	]);
	return {
		data: listed.data,
		counts,
		pagination: listed.pagination,
		meta: {
			cacheSource: 'firestore',
			revision,
			stale: false,
			builtAt: null,
			serverDurationMs: performance.now() - startedAt,
			cacheLookupMs: 0,
			firestoreMs: listed.timings?.firestore || 0,
			serializationMs: listed.timings?.serialization || 0,
			returnedRows: listed.data.length,
		},
	};
}

export async function getCachedTitleReviewCounts() {
	return getTitleReviewCountsNative();
}

export async function rebuildTitleReviewReadModel() {
	return { revision: await getTitleReviewRevision({ force: true }), counts: await getTitleReviewCountsNative(), current: true };
}

export function scheduleTitleReviewReadModelRebuild() {
	// Firestore indexes update synchronously with document writes.
}

export async function markTitleReviewReadModelChanged() {
	return bumpTitleReviewRevision();
}

export async function patchTitleReviewReadModel() {
	return { revision: await bumpTitleReviewRevision(), patched: true };
}

export function getTitleReviewReadModelState() {
	return { revision: revisionCache.value, builtAt: null, rows: null, building: false };
}

export function finalizeTitleReviewSnapshot(rows, revision) {
	return { revision: String(revision || 1), entries: rows || [] };
}

export const titleReviewReadModelTest = {
	compareNewest,
	compareOldest,
	compareConfidence,
	reset() { revisionCache = { value: '1', expiresAt: 0 }; },
};
