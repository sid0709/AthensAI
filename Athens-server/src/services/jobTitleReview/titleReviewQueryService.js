import { getFirestoreDb } from '../firebase/firebaseAdmin.js';

export const TITLE_REVIEW_TABS = new Set(['unreviewed', 'review_required', 'failed']);
export const TITLE_REVIEW_SORTS = new Set(['confidence_desc', 'newest', 'oldest']);

const PHYSICAL_JOBS_COLLECTION = 'jobs';
const SOURCE_CATALOG = 'market';
const QUERY_TIMEOUT_MS = Math.max(500, Math.min(5_000, Number(process.env.TITLE_REVIEW_QUERY_TIMEOUT_MS || 4_500)));
const BASE_LIST_FIELDS = [
	'title',
	'company.name',
	'companyName',
	'source',
	'postedAt',
	'_createdAt',
	'applyLink',
	'jobLink',
];
const SNAPSHOT_FIELDS = [
	...BASE_LIST_FIELDS,
	'titleReview.processingState',
	'titleReview.label',
	'titleReview.confidence',
	'titleReview.reason',
	'titleReview.error.code',
	'titleReview.error.message',
	'titleReview.error.failedAt',
	'titleReview.aiLabel',
	'titleReview.originalTitle',
	'titleReview.decisionSource',
	'titleReview.classifiedAt',
	'titleReview.approvedAt',
	'titleReview.approvedBy',
	'titleReview.lease.sessionId',
	'titleReview.lease.claimedAt',
];

function listFieldsForTab(tab) {
	if (tab === 'review_required') {
		return [...BASE_LIST_FIELDS, 'titleReview.confidence', 'titleReview.reason'];
	}
	if (tab === 'failed') {
		return [
			...BASE_LIST_FIELDS,
			'titleReview.processingState',
			'titleReview.error.code',
			'titleReview.error.message',
			'titleReview.error.failedAt',
		];
	}
	return [...BASE_LIST_FIELDS, 'titleReview.processingState'];
}

export class TitleReviewQueryError extends Error {
	constructor(message, { code, status = 503, retryAfter = 2, cause } = {}) {
		super(message, { cause });
		this.name = 'TitleReviewQueryError';
		this.code = code || 'TITLE_REVIEW_QUERY_FAILED';
		this.status = status;
		this.retryAfter = retryAfter;
	}
}

function normalizeDate(value) {
	if (value?.toDate instanceof Function) return value.toDate().toISOString();
	if (value instanceof Date) return value.toISOString();
	return value ?? null;
}

function reviewCompany(job) {
	if (typeof job?.company === 'string') return job.company;
	return String(job?.company?.name || job?.companyName || 'Unknown');
}

export function mapTitleReviewDocument(document) {
	const job = document?.data instanceof Function ? document.data() : document?.data || document || {};
	return {
		id: String(document?.id ?? job._id ?? ''),
		title: String(job.title || 'Untitled role'),
		company: reviewCompany(job),
		source: String(job.source || 'Other'),
		postedAt: normalizeDate(job.postedAt || job._createdAt),
		applyUrl: String(job.applyLink || job.jobLink || ''),
		titleReview: job.titleReview || null,
	};
}

export function normalizeTitleReviewRequest(options = {}) {
	const requestedTab = String(options.tab || 'unreviewed');
	const tab = TITLE_REVIEW_TABS.has(requestedTab) ? requestedTab : 'unreviewed';
	const page = Math.max(1, Math.floor(Number(options.page) || 1));
	const limit = Math.max(10, Math.min(500, Math.floor(Number(options.limit) || 50)));
	const requestedSort = String(options.sort || '');
	const sort = TITLE_REVIEW_SORTS.has(requestedSort)
		? requestedSort
		: tab === 'review_required' ? 'confidence_desc' : 'newest';
	return { tab, page, limit, sort, q: String(options.q || '').trim() };
}

function physicalJobsCollection(db = getFirestoreDb()) {
	return db.collection(PHYSICAL_JOBS_COLLECTION);
}

function filteredQuery(collection, tab) {
	let query = collection.where('sourceCatalog', '==', SOURCE_CATALOG);
	if (tab === 'review_required') return query.where('titleReview.label', '==', 'REVIEW_REQUIRED');
	if (tab === 'failed') return query.where('titleReview.processingState', '==', 'failed');
	return query.where('titleReview.processingState', 'in', ['pending', 'scanning']);
}

export function buildTitleReviewFirestoreQuery(collection, options = {}) {
	const { tab, sort } = normalizeTitleReviewRequest(options);
	let query = filteredQuery(collection, tab);
	if (tab === 'review_required' && sort === 'confidence_desc') {
		return query.orderBy('titleReview.confidence', 'desc').orderBy('postedAt', 'desc');
	}
	const direction = sort === 'oldest' ? 'asc' : 'desc';
	return query.orderBy('postedAt', direction);
}

function countValue(snapshot) {
	return Number(snapshot?.data instanceof Function ? snapshot.data().count : snapshot?.count) || 0;
}

function classifyFirestoreError(error) {
	if (error instanceof TitleReviewQueryError) return error;
	const code = Number(error?.code);
	const message = String(error?.message || error || 'Title review query failed');
	if (code === 9 || /requires an index|index is currently building/i.test(message)) {
		return new TitleReviewQueryError(
			'The title-review Firestore index is not ready. Retry after index deployment completes.',
			{ code: 'TITLE_REVIEW_INDEX_NOT_READY', retryAfter: 5, cause: error },
		);
	}
	return new TitleReviewQueryError(message, { cause: error });
}

function withQueryTimeout(promise, timeoutMs = QUERY_TIMEOUT_MS) {
	let timer;
	const timeout = new Promise((_resolve, reject) => {
		timer = setTimeout(() => reject(new TitleReviewQueryError(
			`Title-review query exceeded ${timeoutMs}ms.`,
			{ code: 'TITLE_REVIEW_QUERY_TIMEOUT', retryAfter: 2 },
		)), timeoutMs);
		timer.unref?.();
	});
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function countTab(collection, tab) {
	return countValue(await filteredQuery(collection, tab).count().get());
}

/** Execute only the exact native query. There is intentionally no compatibility scan. */
export async function listTitleReviewJobsNative(options = {}, {
	db = getFirestoreDb(),
	includeCount = true,
} = {}) {
	const normalized = normalizeTitleReviewRequest(options);
	if (normalized.q) {
		throw new TitleReviewQueryError(
			'Title search is available after the title-review cache finishes warming.',
			{ code: 'TITLE_REVIEW_CACHE_WARMING', retryAfter: 2 },
		);
	}
	const startedAt = performance.now();
	const collection = physicalJobsCollection(db);
	const query = buildTitleReviewFirestoreQuery(collection, normalized)
		.select(...listFieldsForTab(normalized.tab))
		.offset((normalized.page - 1) * normalized.limit)
		.limit(normalized.limit);
	try {
		const [snapshot, total] = await withQueryTimeout(Promise.all([
			query.get(),
			includeCount ? countTab(collection, normalized.tab) : Promise.resolve(null),
		]));
		const mappedAt = performance.now();
		const data = snapshot.docs.map(mapTitleReviewDocument);
		return {
			data,
			pagination: {
				page: normalized.page,
				limit: normalized.limit,
				total: total ?? 0,
				totalPages: total == null ? 0 : Math.ceil(total / normalized.limit),
			},
			timings: {
				firestore: mappedAt - startedAt,
				serialization: performance.now() - mappedAt,
			},
		};
	} catch (error) {
		throw classifyFirestoreError(error);
	}
}

/** Aggregate queue counts without loading any job documents. */
export async function getTitleReviewCountsNative({ db = getFirestoreDb(), timeoutMs = QUERY_TIMEOUT_MS } = {}) {
	const collection = physicalJobsCollection(db);
	const base = () => collection.where('sourceCatalog', '==', SOURCE_CATALOG);
	try {
		const snapshots = await withQueryTimeout(Promise.all([
			base().where('titleReview.processingState', 'in', ['pending', 'failed']).count().get(),
			base().where('titleReview.processingState', 'in', ['pending', 'scanning']).count().get(),
			base().where('titleReview.label', '==', 'REVIEW_REQUIRED').count().get(),
			base().where('titleReview.processingState', '==', 'failed').count().get(),
		]), timeoutMs);
		const [pending, unreviewedCount, reviewRequiredCount, failedCount] = snapshots.map(countValue);
		return { pending, unreviewedCount, reviewRequiredCount, failedCount };
	} catch (error) {
		throw classifyFirestoreError(error);
	}
}

/** Stream one complete indexed queue for background snapshot construction. */
export async function scanTitleReviewQueue(tab, {
	db = getFirestoreDb(),
	pageSize = 1_000,
} = {}) {
	const collection = physicalJobsCollection(db);
	const rows = [];
	let lastDocument = null;
	try {
		for (;;) {
			let query = buildTitleReviewFirestoreQuery(collection, { tab, sort: 'newest' })
				.select(...SNAPSHOT_FIELDS)
				.limit(Math.max(25, Math.min(2_000, pageSize)));
			if (lastDocument) query = query.startAfter(lastDocument);
			const snapshot = await query.get();
			rows.push(...snapshot.docs.map(mapTitleReviewDocument));
			if (snapshot.empty || snapshot.size < pageSize) break;
			lastDocument = snapshot.docs.at(-1);
		}
		return rows;
	} catch (error) {
		throw classifyFirestoreError(error);
	}
}

/**
 * Build the derived snapshot from Firestore's automatic single-field indexes.
 * This reads only documents already in the requested title-review queue and
 * never enters the generic adapter or scans the full jobs collection.
 */
export async function scanTitleReviewQueueForSnapshot(tab, {
	db = getFirestoreDb(),
	pageSize = 1_000,
} = {}) {
	const collection = physicalJobsCollection(db);
	const normalizedTab = normalizeTitleReviewRequest({ tab }).tab;
	const effectivePageSize = Math.max(25, Math.min(2_000, pageSize));
	const rows = [];
	let lastDocument = null;
	try {
		for (;;) {
			let query = normalizedTab === 'review_required'
				? collection.where('titleReview.label', '==', 'REVIEW_REQUIRED')
				: normalizedTab === 'failed'
					? collection.where('titleReview.processingState', '==', 'failed')
					: collection.where('titleReview.processingState', 'in', ['pending', 'scanning']);
			query = query.select('sourceCatalog', ...SNAPSHOT_FIELDS).limit(effectivePageSize);
			if (lastDocument) query = query.startAfter(lastDocument);
			const snapshot = await query.get();
			for (const document of snapshot.docs) {
				if (document.data()?.sourceCatalog === SOURCE_CATALOG) rows.push(mapTitleReviewDocument(document));
			}
			if (snapshot.empty || snapshot.size < effectivePageSize) break;
			lastDocument = snapshot.docs.at(-1);
		}
		return rows;
	} catch (error) {
		throw classifyFirestoreError(error);
	}
}

export const titleReviewQueryServiceTest = {
	filteredQuery,
	classifyFirestoreError,
	countValue,
};
