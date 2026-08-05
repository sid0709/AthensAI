import { createHash } from 'node:crypto';
import { FieldPath } from 'firebase-admin/firestore';
import { JobSourceTitles } from '../config/jobSources.js';
import { isExtensionV2Job } from '../config/jobMarketSchema.js';
import { jobsCollection, getVendorTasksCollection } from '../db/dataStore.js';
import { getFirestoreDb } from './firebase/firebaseAdmin.js';
import { resolveApplierContext } from './jobListQuery.js';
import { getProfileJobStatusIndex } from './jobStatusIndexService.js';
import {
	jobStatusProjectionId,
	readMaterializedJobStatusCounts,
	countLiveJobStatusesByState,
	countJobStatusesByStateAggregated,
	statusRowFromProjection,
} from './jobStatusProjectionService.js';
import { isAlgoliaConfigured, searchNewestJobPage } from './search/algoliaJobs.js';
import { readApprovedCatalogCount } from './jobCatalogCountService.js';

const JOB_COLLECTION = 'jobs';
const MARKET_CATALOG = 'market';
const STATUS_COLLECTION = 'job_statuses';
const PAGE_LIMIT_MAX = 100;
const SCAN_BATCH_SIZE = 100;
const MAX_SCAN_BATCHES = 20;
const COUNT_CACHE_MS = Math.max(1_000, Number(process.env.JOB_LIST_V3_COUNT_CACHE_MS || 60_000));
const COMPANY_COUNT_CACHE_MS = Math.max(COUNT_CACHE_MS, Number(process.env.JOB_LIST_V3_COMPANY_COUNT_CACHE_MS || 300_000));
const catalogCountCache = new Map();
const companyCountCache = new Map();
const statusCountCache = new Map();

const STATUS_FROM_API = {
	Applied: 'applied',
	Scheduled: 'scheduled',
	Declined: 'declined',
	BidReady: 'bid-ready',
	BidCompleted: 'bid-completed',
};

function marketJobs() {
	return getFirestoreDb().collection(JOB_COLLECTION).where('sourceCatalog', '==', MARKET_CATALOG);
}

function asDate(value) {
	if (!value) return null;
	if (value instanceof Date) return value;
	if (typeof value?.toDate === 'function') return value.toDate();
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

function cursorPoint(postedAt, id) {
	const date = asDate(postedAt);
	const iso = typeof postedAt === 'string' && postedAt.trim()
		? postedAt.trim()
		: (date?.toISOString() || new Date(0).toISOString());
	return {
		postedAtMs: date?.getTime() || 0,
		postedAt: iso,
		id: String(id || ''),
	};
}

/** Jobs/statuses store postedAt as ISO strings; Date/Timestamp cursors do not seek. */
function startAfterIsoPoint(query, point) {
	if (!point?.id) return query;
	const postedAt = typeof point.postedAt === 'string' && point.postedAt
		? point.postedAt
		: (asDate(point.postedAtMs ?? point.postedAt)?.toISOString() || new Date(0).toISOString());
	return query.startAfter(postedAt, String(point.id));
}

function decodeValue(value) {
	if (typeof value?.toDate === 'function') return value.toDate();
	if (Array.isArray(value)) return value.map(decodeValue);
	if (value && Object.getPrototypeOf(value) === Object.prototype) {
		return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, decodeValue(child)]));
	}
	return value;
}

function decodeJob(snapshot) {
	return { ...decodeValue(snapshot.data()), _id: snapshot.id };
}

function stable(value) {
	if (Array.isArray(value)) return value.map(stable);
	if (value && Object.getPrototypeOf(value) === Object.prototype) {
		return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
	}
	return value;
}

function cursorHash(body) {
	const copy = { ...body };
	for (const key of ['cursor', 'page', 'skip', 'countsOnly']) delete copy[key];
	copy.sort = 'newest';
	return createHash('sha256').update(JSON.stringify(stable(copy))).digest('hex').slice(0, 24);
}

function encodeCursor(payload) {
	return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function decodeCursor(raw, expectedHash, expectedKind) {
	if (!raw) return null;
	try {
		const value = JSON.parse(Buffer.from(String(raw), 'base64url').toString('utf8'));
		if (value?.v !== 1 || value?.h !== expectedHash || value?.kind !== expectedKind) throw new Error();
		return value;
	} catch {
		throw Object.assign(new Error('Invalid or stale Job Search cursor'), { status: 400 });
	}
}

function requestedStatus(body = {}) {
	if (body.applied === false || body.applied === 'false') return 'new';
	if (body.applied === true || body.applied === 'true') return STATUS_FROM_API[body.status] || 'any';
	return 'all';
}

function selectedSources(body = {}) {
	const supplied = String(body.jobSources || '').split(',').map((item) => item.trim()).filter(Boolean);
	const sources = supplied.length ? supplied : JobSourceTitles;
	const known = JobSourceTitles.filter((source) => source !== 'Other');
	const all = sources.includes('Other') && known.every((source) => sources.includes(source));
	return all ? null : [...new Set(sources)].slice(0, 30);
}

function stringIncludes(value, expected) {
	return String(value || '').toLowerCase().includes(String(expected || '').trim().toLowerCase());
}

function matchesFilters(job, body, { isBeta, sources }) {
	if (job?.titleReview?.label !== 'APPROVED') return false;
	if (!isBeta && isExtensionV2Job(job)) return false;
	if (sources && !sources.includes(String(job.source || ''))) return false;
	if ((body.aiExtracted === true || body.aiExtracted === 'true') && job.aiSkillStatus !== 'extracted') return false;
	if (body['details.remote'] && String(job.details?.remote || '') !== String(body['details.remote'])) return false;
	if (body['details.time'] && String(job.details?.time || '') !== String(body['details.time'])) return false;
	if (body['details.position'] && !stringIncludes(job.details?.position, body['details.position'])) return false;
	if (body['company.name'] && !stringIncludes(job.company?.name || job.companyName, body['company.name'])) return false;
	if (body.companyId && String(job.companyId || '') !== String(body.companyId)) return false;
	if (body['details.seniority']) {
		const allowed = String(body['details.seniority']).split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
		if (allowed.length && !allowed.some((value) => stringIncludes(job.details?.seniority, value))) return false;
	}
	if (body['company.tags']) {
		const expected = String(body['company.tags']).split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
		const actual = (Array.isArray(job.company?.tags) ? job.company.tags : []).map((value) => String(value).toLowerCase());
		if (expected.some((tag) => !actual.some((value) => value.includes(tag)))) return false;
	}
	const postedAt = asDate(job.postedAt || job._createdAt || job.createdAt);
	const from = asDate(body.postedAtFrom);
	const to = asDate(body.postedAtTo);
	if (from && (!postedAt || postedAt < from)) return false;
	if (to) {
		const end = new Date(to);
		if (String(body.postedAtTo).length <= 10) end.setUTCHours(23, 59, 59, 999);
		if (!postedAt || postedAt > end) return false;
	}
	return true;
}

function nativeFacet(body, sources) {
	const facets = [];
	if (sources) facets.push({ field: 'source', operator: 'in', value: sources });
	if (body.aiExtracted === true || body.aiExtracted === 'true') facets.push({ field: 'aiSkillStatus', operator: '==', value: 'extracted' });
	if (body['details.remote']) facets.push({ field: 'details.remote', operator: '==', value: String(body['details.remote']) });
	if (body['details.time']) facets.push({ field: 'details.time', operator: '==', value: String(body['details.time']) });
	if (body.companyId) facets.push({ field: 'companyId', operator: '==', value: String(body.companyId) });
	return facets.length <= 1 ? facets[0] || null : null;
}

function requiresAlgolia(body, sources) {
	if (String(body.q || '').trim() || body['company.name'] || body['details.position'] || body['details.seniority'] || body['company.tags']) return true;
	let exact = 0;
	if (sources) exact += 1;
	if (body.aiExtracted === true || body.aiExtracted === 'true') exact += 1;
	if (body['details.remote']) exact += 1;
	if (body['details.time']) exact += 1;
	if (body.companyId) exact += 1;
	return exact > 1;
}

function preferAlgoliaBrowse(_body, _sources, tab) {
	return isAlgoliaConfigured() && ['all', 'new'].includes(tab);
}

function statusMap(index) {
	return new Map([...index.rows.values()].map((value) => [value.jobId, value]));
}

async function hydrateStatusRows(profileId, jobIds) {
	if (!profileId || !jobIds.length) return new Map();
	const db = getFirestoreDb();
	const unique = [...new Set(jobIds.map(String))];
	const out = new Map();
	for (let offset = 0; offset < unique.length; offset += 100) {
		const chunk = unique.slice(offset, offset + 100);
		const refs = chunk.map((jobId) => db.collection(STATUS_COLLECTION).doc(jobStatusProjectionId(profileId, jobId)));
		const snapshots = await db.getAll(...refs);
		for (const snapshot of snapshots) {
			if (!snapshot.exists) continue;
			const raw = snapshot.data() || {};
			const jobId = String(raw.jobId || '');
			if (!jobId) continue;
			out.set(jobId, {
				jobId,
				state: String(raw.state || ''),
				visibleInJobSearch: raw.visibleInJobSearch !== false,
				postedAt: raw.postedAt || null,
				row: statusRowFromProjection(raw),
			});
		}
	}
	return out;
}

function attachViewerStatus(job, row) {
	return {
		...job,
		viewerStatus: row?.state || 'posted',
		status: row?.row ? [row.row] : [],
	};
}

function statusMatches(row, tab) {
	if (tab === 'all') return true;
	if (tab === 'new') return !row;
	if (tab === 'any') return Boolean(row && row.visibleInJobSearch !== false);
	return Boolean(row && row.visibleInJobSearch !== false && row.state === tab);
}

async function resolveViewer(body) {
	const name = String(body.applierName || '').trim();
	const context = name ? await resolveApplierContext(name) : { id: null, isBeta: false };
	if (name && !context.id) throw Object.assign(new Error(`User ${name} not found`), { status: 404 });
	return { profileId: context.id ? String(context.id) : null, isBeta: Boolean(context.isBeta) };
}

const LIST_JOB_FIELDS = [
	'title',
	'company',
	'companyId',
	'companyName',
	'source',
	'postedAt',
	'_createdAt',
	'createdAt',
	'extensionV2',
	'version',
	'aiSkillStatus',
	'details',
	'titleReview',
	'applyLink',
	'jobLink',
	'sourceCatalog',
];

function nativeJobsQuery(body, facet, { isBeta = false } = {}) {
	// Physical documents live in `jobs` with sourceCatalog=market; `job_market`
	// is only the adapter alias and is empty as a native collection.
	let query = marketJobs().where('titleReview.label', '==', 'APPROVED');
	// Non-beta viewers must not spend scan budget on extension-v2 rows that
	// matchesFilters would discard. Counts already use this same predicate.
	if (!isBeta) query = query.where('extensionV2', '==', false);
	if (facet) query = query.where(facet.field, facet.operator, facet.value);
	const from = asDate(body.postedAtFrom);
	const to = asDate(body.postedAtTo);
	if (from) query = query.where('postedAt', '>=', from);
	if (to) {
		const end = new Date(to);
		if (String(body.postedAtTo).length <= 10) end.setUTCHours(23, 59, 59, 999);
		query = query.where('postedAt', '<=', end);
	}
	return query
		.orderBy('postedAt', 'desc')
		.orderBy(FieldPath.documentId(), 'desc')
		.select(...LIST_JOB_FIELDS);
}

async function listNative(body, context) {
	const { limit, tab, hash, sources, isBeta, statuses, profileId } = context;
	const cursor = decodeCursor(body.cursor, hash, 'jobs');
	let query = startAfterIsoPoint(nativeJobsQuery(body, nativeFacet(body, sources), { isBeta }), cursor);
	const data = [];
	let lastScanned = cursor ? cursorPoint(cursor.postedAtMs ?? cursor.postedAt, cursor.id) : null;
	const fetchLimit = limit + 1;
	for (let batch = 0; batch < MAX_SCAN_BATCHES && data.length < fetchLimit; batch += 1) {
		const snapshot = await query.limit(SCAN_BATCH_SIZE).get();
		if (snapshot.empty) break;
		const pageStatuses = (tab === 'all' || !profileId)
			? new Map()
			: (statuses?.size
				? statuses
				: await hydrateStatusRows(profileId, snapshot.docs.map((document) => document.id)));
		for (const document of snapshot.docs) {
			const job = decodeJob(document);
			lastScanned = cursorPoint(job.postedAt, document.id);
			const row = pageStatuses.get(document.id);
			if (!matchesFilters(job, body, { isBeta, sources }) || !statusMatches(row, tab)) continue;
			data.push(attachViewerStatus(job, row));
			if (data.length === fetchLimit) break;
		}
		if (data.length === fetchLimit) break;
		if (snapshot.size < SCAN_BATCH_SIZE) break;
		query = startAfterIsoPoint(nativeJobsQuery(body, nativeFacet(body, sources), { isBeta }), lastScanned);
	}
	const hasMore = data.length > limit;
	const pageData = hasMore ? data.slice(0, limit) : data;
	const cursorSource = pageData.length ? pageData[pageData.length - 1] : null;
	const nextPoint = cursorSource
		? cursorPoint(cursorSource.postedAt, cursorSource._id)
		: null;
	return {
		data: pageData,
		hasMore,
		nextCursor: hasMore && nextPoint ? encodeCursor({ v: 1, h: hash, kind: 'jobs', ...nextPoint }) : null,
	};
}

async function hydrateJobIds(ids) {
	if (!ids.length) return new Map();
	const db = getFirestoreDb();
	const unique = [...new Set(ids.map(String))];
	const out = new Map();
	// Prefer ranged `in` + select over getAll so Applied/Scheduled tabs do not
	// download full job descriptions for every card.
	for (let offset = 0; offset < unique.length; offset += 30) {
		const chunk = unique.slice(offset, offset + 30);
		const snapshot = await db.collection(JOB_COLLECTION)
			.where(FieldPath.documentId(), 'in', chunk)
			.select(...LIST_JOB_FIELDS)
			.get();
		for (const document of snapshot.docs) out.set(document.id, decodeJob(document));
	}
	return out;
}

function algoliaQuery(body) {
	return [body.q, body['company.name']].map((value) => String(value || '').trim()).filter(Boolean).join(' ');
}

async function listAlgolia(body, context) {
	const { limit, tab, hash, sources, isBeta, statuses, profileId } = context;
	const cursor = decodeCursor(body.cursor, hash, 'algolia') || { page: 0, offset: 0 };
	let page = Number(cursor.page || 0);
	let offset = Number(cursor.offset || 0);
	let hasMore = true;
	const data = [];
	for (let scannedPages = 0; scannedPages < MAX_SCAN_BATCHES && data.length < limit; scannedPages += 1) {
		const result = await searchNewestJobPage(algoliaQuery(body), {
			page,
			hitsPerPage: SCAN_BATCH_SIZE,
		});
		if (!result) throw Object.assign(new Error('Algolia is required for this Job Search filter'), { status: 503, retryable: true });
		const ids = result.ids.slice(offset);
		const [jobs, pageStatuses] = await Promise.all([
			hydrateJobIds(ids),
			(tab === 'all' || !profileId)
				? Promise.resolve(new Map())
				: (statuses?.size ? Promise.resolve(statuses) : hydrateStatusRows(profileId, ids)),
		]);
		for (let index = 0; index < ids.length; index += 1) {
			const jobId = ids[index];
			offset += 1;
			const job = jobs.get(jobId);
			const row = pageStatuses.get(jobId);
			if (!job || !matchesFilters(job, body, { isBeta, sources }) || !statusMatches(row, tab)) continue;
			data.push(attachViewerStatus(job, row));
			if (data.length === limit) break;
		}
		if (data.length === limit) {
			hasMore = page < result.nbPages - 1 || offset < result.ids.length;
			break;
		}
		if (page >= result.nbPages - 1) { hasMore = false; break; }
		page += 1;
		offset = 0;
	}
	return {
		data,
		hasMore,
		nextCursor: hasMore ? encodeCursor({ v: 1, h: hash, kind: 'algolia', page, offset }) : null,
	};
}

async function listStatusQuery(body, context) {
	const { limit, tab, hash, sources, isBeta, profileId } = context;
	if (!profileId) throw Object.assign(new Error('applierName is required for status tabs'), { status: 400 });
	const cursor = decodeCursor(body.cursor, hash, 'statuses');
	const db = getFirestoreDb();
	let query = db.collection(STATUS_COLLECTION)
		.where('profileId', '==', profileId)
		.where('state', '==', tab)
		.orderBy('postedAt', 'desc')
		.orderBy('jobId', 'desc');
	if (cursor) query = startAfterIsoPoint(query, cursor);
	const data = [];
	const fetchLimit = limit + 1;
	for (let batch = 0; batch < MAX_SCAN_BATCHES && data.length < fetchLimit; batch += 1) {
		const snapshot = await query.limit(Math.min(SCAN_BATCH_SIZE, fetchLimit - data.length + 5)).get();
		if (snapshot.empty) break;
		const rows = snapshot.docs.map((document) => {
			const raw = document.data() || {};
			return {
				jobId: String(raw.jobId || ''),
				state: String(raw.state || ''),
				visibleInJobSearch: raw.visibleInJobSearch !== false,
				postedAt: raw.postedAt || null,
				row: statusRowFromProjection(raw),
			};
		}).filter((row) => row.jobId && row.visibleInJobSearch !== false);
		const jobs = await hydrateJobIds(rows.map((row) => row.jobId));
		let lastScanned = null;
		for (const row of rows) {
			lastScanned = cursorPoint(row.postedAt, row.jobId);
			const job = jobs.get(row.jobId);
			if (!job || !matchesFilters(job, body, { isBeta, sources })) continue;
			data.push(attachViewerStatus(job, row));
			if (data.length === fetchLimit) break;
		}
		if (data.length === fetchLimit) break;
		if (snapshot.size < Math.min(SCAN_BATCH_SIZE, fetchLimit - data.length + 5)) break;
		query = startAfterIsoPoint(
			db.collection(STATUS_COLLECTION)
				.where('profileId', '==', profileId)
				.where('state', '==', tab)
				.orderBy('postedAt', 'desc')
				.orderBy('jobId', 'desc'),
			lastScanned || cursorPoint(snapshot.docs.at(-1).get('postedAt'), snapshot.docs.at(-1).get('jobId')),
		);
	}
	const hasMore = data.length > limit;
	const pageData = hasMore ? data.slice(0, limit) : data;
	const cursorSource = pageData.length ? pageData[pageData.length - 1] : null;
	const nextPoint = cursorSource
		? cursorPoint(cursorSource.postedAt, cursorSource._id)
		: null;
	return {
		data: pageData,
		hasMore,
		nextCursor: hasMore && nextPoint ? encodeCursor({ v: 1, h: hash, kind: 'statuses', ...nextPoint }) : null,
	};
}

async function approvedCatalogCount(isBeta) {
	const key = isBeta ? 'beta' : 'public';
	const cached = catalogCountCache.get(key);
	if (cached?.expiresAt > Date.now()) return cached.value;
	let value = await readApprovedCatalogCount({ includeExtensionV2: isBeta });
	if (value == null) {
		try {
			let query = marketJobs().where('titleReview.label', '==', 'APPROVED');
			if (!isBeta) query = query.where('extensionV2', '==', false);
			const snapshot = await query.count().get();
			value = Number(snapshot.data().count || 0);
		} catch {
			const filter = isBeta
				? { 'titleReview.label': 'APPROVED' }
				: { 'titleReview.label': 'APPROVED', extensionV2: false };
			value = await jobsCollection.countDocuments(filter);
		}
	}
	catalogCountCache.set(key, { value, expiresAt: Date.now() + COUNT_CACHE_MS });
	return value;
}

export function invalidateJobListV3Counts() {
	catalogCountCache.clear();
	companyCountCache.clear();
	statusCountCache.clear();
}

async function attachCompanyCounts(jobs, isBeta) {
	const ids = [...new Set(jobs.map((job) => String(job.companyId || '').trim()).filter(Boolean))];
	const now = Date.now();
	const counts = new Map();
	const uncached = [];
	for (const companyId of ids) {
		const key = `${isBeta ? 'beta' : 'public'}:${companyId}`;
		const cached = companyCountCache.get(key);
		if (cached?.expiresAt > now) counts.set(companyId, cached.value);
		else uncached.push(companyId);
	}
	// Hot path: never block on company doc reads or count queries. Warm denorm
	// counters asynchronously so the next page hits memory/company fields.
	if (uncached.length) {
		const db = getFirestoreDb();
		void (async () => {
			try {
				for (let offset = 0; offset < uncached.length; offset += 100) {
					const chunk = uncached.slice(offset, offset + 100);
					const snapshots = await db.getAll(...chunk.map((companyId) => db.collection('companies').doc(companyId)));
					const stillMissing = [];
					for (let index = 0; index < snapshots.length; index += 1) {
						const snapshot = snapshots[index];
						const companyId = chunk[index];
						const data = snapshot.exists ? (snapshot.data() || {}) : {};
						const value = Number(isBeta ? data.approvedJobCount : data.publicApprovedJobCount);
						if (Number.isFinite(value) && value > 0) {
							companyCountCache.set(
								`${isBeta ? 'beta' : 'public'}:${companyId}`,
								{ value: Math.max(1, value), expiresAt: Date.now() + COMPANY_COUNT_CACHE_MS },
							);
						} else {
							stillMissing.push(companyId);
						}
					}
					await Promise.all(stillMissing.map(async (companyId) => {
						const [allSnap, publicSnap] = await Promise.all([
							marketJobs()
								.where('titleReview.label', '==', 'APPROVED')
								.where('companyId', '==', companyId)
								.count()
								.get(),
							marketJobs()
								.where('titleReview.label', '==', 'APPROVED')
								.where('companyId', '==', companyId)
								.where('extensionV2', '==', false)
								.count()
								.get(),
						]);
						const approvedJobCount = Math.max(0, Number(allSnap.data().count || 0));
						const publicApprovedJobCount = Math.max(0, Number(publicSnap.data().count || 0));
						companyCountCache.set(
							`${isBeta ? 'beta' : 'public'}:${companyId}`,
							{
								value: Math.max(1, isBeta ? approvedJobCount : publicApprovedJobCount),
								expiresAt: Date.now() + COMPANY_COUNT_CACHE_MS,
							},
						);
						await db.collection('companies').doc(companyId).set({
							approvedJobCount,
							publicApprovedJobCount,
							approvedJobCountUpdatedAt: new Date(),
						}, { merge: true });
					}));
				}
			} catch {
				// Best-effort warm.
			}
			while (companyCountCache.size > 1_000) companyCountCache.delete(companyCountCache.keys().next().value);
		})();
	}
	return jobs.map((job) => ({
		...job,
		companyMatchingCount: counts.get(String(job.companyId || '')) ?? 1,
	}));
}

function countsFromStatusIndex(index) {
	if (!index?.rows) return null;
	const counts = { any: 0, applied: 0, scheduled: 0, declined: 0, 'bid-ready': 0, 'bid-completed': 0 };
	for (const row of index.rows.values()) {
		if (!row?.jobId || row.visibleInJobSearch === false) continue;
		const state = String(row.state || '').trim();
		if (!state || state === 'posted' || !Object.hasOwn(counts, state)) continue;
		counts[state] += 1;
		counts.any += 1;
	}
	return counts;
}

export async function getJobStatusCountsV3(body = {}, { statusIndex = null } = {}) {
	const { profileId, isBeta } = await resolveViewer(body);
	const all = await approvedCatalogCount(isBeta);
	if (!profileId) {
		return { all, posted: all, 'bid-ready': 0, 'bid-completed': 0, applied: 0, scheduled: 0, declined: 0 };
	}
	const cacheKey = `${profileId}:${isBeta ? 'beta' : 'public'}`;
	const cached = statusCountCache.get(cacheKey);
	if (cached?.expiresAt > Date.now()) {
		const stored = cached.value;
		const any = Math.min(all, Number(stored?.any || 0));
		return {
			all,
			posted: Math.max(0, all - any),
			'bid-ready': Number(stored?.['bid-ready'] || 0),
			'bid-completed': Number(stored?.['bid-completed'] || 0),
			applied: Number(stored?.applied || 0),
			scheduled: Number(stored?.scheduled || 0),
			declined: Number(stored?.declined || 0),
		};
	}
	// Prefer in-memory index, then aggregation counts (source of truth for
	// badges). Sharded counters lag for statuses written before projections.
	let stored = countsFromStatusIndex(statusIndex)
		|| await countJobStatusesByStateAggregated(profileId, { includeExtensionV2: isBeta });
	if (!stored?.any) {
		stored = await readMaterializedJobStatusCounts(profileId, { includeExtensionV2: isBeta });
	}
	if (!stored?.any) {
		const live = await countLiveJobStatusesByState(profileId);
		if (live?.any) stored = live;
	}
	statusCountCache.set(cacheKey, { value: stored, expiresAt: Date.now() + COUNT_CACHE_MS });
	const any = Math.min(all, Number(stored?.any || 0));
	return {
		all,
		posted: Math.max(0, all - any),
		'bid-ready': Number(stored?.['bid-ready'] || 0),
		'bid-completed': Number(stored?.['bid-completed'] || 0),
		applied: Number(stored?.applied || 0),
		scheduled: Number(stored?.scheduled || 0),
		declined: Number(stored?.declined || 0),
	};
}

function totalForTab(tab, statusCounts) {
	if (tab === 'all') return Number(statusCounts.all || 0);
	if (tab === 'new') return Number(statusCounts.posted || 0);
	return Number(statusCounts[tab] || 0);
}

/** Attach Library recommend fields from vendor_tasks onto list rows. */
async function attachRecommendFields(jobs, applierName) {
	const name = String(applierName || '').trim();
	const rows = Array.isArray(jobs) ? jobs : [];
	if (!name || !rows.length) return rows;
	const collection = getVendorTasksCollection();
	if (!collection) return rows;

	const jobIds = [...new Set(rows.map((job) => String(job?._id || '').trim()).filter(Boolean))];
	if (!jobIds.length) return rows;

	const tasks = await collection
		.find(
			{ applierName: name, jobId: { $in: jobIds } },
			{
				projection: {
					jobId: 1,
					recommendedResumeStack: 1,
					recommendedResumeReason: 1,
					useCustomizedResume: 1,
					recommendWarning: 1,
					recommendedAt: 1,
				},
			},
		)
		.toArray();

	const byJobId = new Map();
	for (const task of tasks) {
		const jobId = String(task.jobId || '').trim();
		if (!jobId) continue;
		byJobId.set(jobId, task);
	}
	if (!byJobId.size) return rows;

	return rows.map((job) => {
		const task = byJobId.get(String(job?._id || '').trim());
		if (!task) return job;
		return {
			...job,
			recommendedResumeStack: task.recommendedResumeStack || null,
			recommendedResumeReason: task.recommendedResumeReason || null,
			useCustomizedResume: Boolean(task.useCustomizedResume),
			recommendWarning: task.recommendWarning || null,
			recommendedAt:
				task.recommendedAt instanceof Date
					? task.recommendedAt.toISOString()
					: task.recommendedAt || null,
		};
	});
}

export async function listJobsV3(body = {}) {
	const requestedSort = String(body.sort || 'newest');
	if (!['newest', 'postedAt_desc'].includes(requestedSort)) {
		throw Object.assign(new Error('Job Search supports newest sort only'), { status: 400 });
	}
	const limit = Math.max(1, Math.min(PAGE_LIMIT_MAX, Number(body.limit || 25)));
	const pageNumber = Math.max(1, Number(body.page || 1));
	const tab = requestedStatus(body);
	const { profileId, isBeta } = await resolveViewer(body);
	const sources = selectedSources(body);
	const hash = cursorHash({ ...body, cursor: undefined, applierName: body.applierName || null });
	// New tab needs an anti-join. Prefer the warm in-memory index over per-page
	// getAll. Applied/Bid tabs query status docs directly. All skips status I/O.
	let statuses = new Map();
	if (tab === 'new' && profileId) {
		statuses = statusMap(await getProfileJobStatusIndex(profileId));
	}
	const context = { limit, tab, profileId, isBeta, statuses, sources, hash };
	let page;
	try {
		if (requiresAlgolia(body, sources) || preferAlgoliaBrowse(body, sources, tab)) {
			page = await listAlgolia(body, context);
		} else if (!['all', 'new'].includes(tab)) {
			page = await listStatusQuery(body, context);
		} else {
			page = await listNative(body, context);
		}
	} catch (error) {
		const canFallbackNative = preferAlgoliaBrowse(body, sources, tab)
			&& !requiresAlgolia(body, sources)
			&& (error?.status === 503 || /algolia/i.test(String(error?.message || '')));
		if (!canFallbackNative) throw error;
		page = await listNative(body, context);
	}
	const [withCompanyCounts, statusCounts] = await Promise.all([
		attachCompanyCounts(page.data, isBeta),
		getJobStatusCountsV3(body),
	]);
	page.data = await attachRecommendFields(withCompanyCounts, body.applierName);
	let totalJobs = totalForTab(tab, statusCounts);
	// When sharded badges lag behind the list query, never advertise an empty
	// page that still returned rows (Bid ready 0 + 3 cards).
	const listedFloor = (pageNumber - 1) * limit + page.data.length + (page.hasMore ? 1 : 0);
	if (page.data.length && totalJobs < listedFloor) {
		totalJobs = listedFloor;
		if (tab !== 'all' && tab !== 'new' && Object.hasOwn(statusCounts, tab)) {
			statusCounts[tab] = Math.max(Number(statusCounts[tab] || 0), totalJobs);
		}
	}
	const advertisedPages = Math.max(1, Math.ceil(Math.max(0, totalJobs) / limit));
	const totalPages = page.hasMore
		? Math.max(advertisedPages, pageNumber + 1)
		: Math.max(1, Math.min(advertisedPages, Math.max(pageNumber, 1)));
	return {
		success: true,
		data: page.data,
		nextCursor: page.nextCursor,
		hasMore: page.hasMore,
		viewerStatus: Object.fromEntries(page.data.map((job) => [String(job._id), job.viewerStatus])),
		statusCounts,
		pagination: {
			page: pageNumber,
			limit,
			total: totalJobs,
			totalJobs,
			totalPages,
			unit: 'jobs',
		},
	};
}
