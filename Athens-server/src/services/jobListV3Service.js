import { createHash } from 'node:crypto';
import { FieldPath } from 'firebase-admin/firestore';
import { JobSourceTitles } from '../config/jobSources.js';
import { isExtensionV2Job } from '../config/jobMarketSchema.js';
import { jobsCollection } from '../db/dataStore.js';
import { getFirestoreDb } from './firebase/firebaseAdmin.js';
import { resolveApplierContext } from './jobListQuery.js';
import { getProfileJobStatusIndex } from './jobStatusIndexService.js';
import { readMaterializedJobStatusCounts } from './jobStatusProjectionService.js';
import { searchNewestJobPage } from './search/algoliaJobs.js';
import { readApprovedCatalogCount } from './jobCatalogCountService.js';

const JOB_COLLECTION = 'job_market';
const STATUS_COLLECTION = 'job_statuses';
const PAGE_LIMIT_MAX = 100;
const SCAN_BATCH_SIZE = 100;
const MAX_SCAN_BATCHES = 20;
const COUNT_CACHE_MS = Math.max(1_000, Number(process.env.JOB_LIST_V3_COUNT_CACHE_MS || 5_000));
const catalogCountCache = new Map();
const companyCountCache = new Map();

const STATUS_FROM_API = {
	Applied: 'applied',
	Scheduled: 'scheduled',
	Declined: 'declined',
	BidReady: 'bid-ready',
	BidCompleted: 'bid-completed',
};

function asDate(value) {
	if (!value) return null;
	if (value instanceof Date) return value;
	if (typeof value?.toDate === 'function') return value.toDate();
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
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

function statusMap(index) {
	return new Map([...index.rows.values()].map((value) => [value.jobId, value]));
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
	if (tab === 'any') return Boolean(row?.visibleInJobSearch);
	return row?.visibleInJobSearch === true && row.state === tab;
}

async function resolveViewer(body) {
	const name = String(body.applierName || '').trim();
	const context = name ? await resolveApplierContext(name) : { id: null, isBeta: false };
	if (name && !context.id) throw Object.assign(new Error(`User ${name} not found`), { status: 404 });
	return { profileId: context.id ? String(context.id) : null, isBeta: Boolean(context.isBeta) };
}

async function viewerIndex(profileId, tab) {
	if (!profileId) {
		if (tab !== 'all') throw Object.assign(new Error('applierName is required for status tabs'), { status: 400 });
		return null;
	}
	return getProfileJobStatusIndex(profileId);
}

function nativeJobsQuery(body, facet) {
	let query = getFirestoreDb().collection(JOB_COLLECTION).where('titleReview.label', '==', 'APPROVED');
	if (facet) query = query.where(facet.field, facet.operator, facet.value);
	const from = asDate(body.postedAtFrom);
	const to = asDate(body.postedAtTo);
	if (from) query = query.where('postedAt', '>=', from);
	if (to) {
		const end = new Date(to);
		if (String(body.postedAtTo).length <= 10) end.setUTCHours(23, 59, 59, 999);
		query = query.where('postedAt', '<=', end);
	}
	return query.orderBy('postedAt', 'desc').orderBy(FieldPath.documentId(), 'desc');
}

async function listNative(body, context) {
	const { limit, tab, hash, sources, isBeta, statuses } = context;
	const cursor = decodeCursor(body.cursor, hash, 'jobs');
	let query = nativeJobsQuery(body, nativeFacet(body, sources));
	if (cursor) query = query.startAfter(new Date(cursor.postedAt), cursor.id);
	const data = [];
	let lastScanned = cursor ? { postedAt: cursor.postedAt, id: cursor.id } : null;
	let hasMore = false;
	for (let batch = 0; batch < MAX_SCAN_BATCHES && data.length < limit; batch += 1) {
		const snapshot = await query.limit(SCAN_BATCH_SIZE).get();
		if (snapshot.empty) { hasMore = false; break; }
		for (const document of snapshot.docs) {
			const job = decodeJob(document);
			const postedAt = asDate(job.postedAt);
			lastScanned = { postedAt: postedAt?.toISOString() || new Date(0).toISOString(), id: document.id };
			const row = statuses.get(document.id);
			if (!matchesFilters(job, body, { isBeta, sources }) || !statusMatches(row, tab)) continue;
			data.push(attachViewerStatus(job, row));
			if (data.length === limit) { hasMore = true; break; }
		}
		if (data.length === limit) break;
		if (snapshot.size < SCAN_BATCH_SIZE) { hasMore = false; break; }
		hasMore = true;
		query = nativeJobsQuery(body, nativeFacet(body, sources)).startAfter(
			new Date(lastScanned.postedAt),
			lastScanned.id,
		);
	}
	return {
		data,
		hasMore,
		nextCursor: hasMore && lastScanned ? encodeCursor({ v: 1, h: hash, kind: 'jobs', ...lastScanned }) : null,
	};
}

async function hydrateJobIds(ids) {
	if (!ids.length) return new Map();
	const db = getFirestoreDb();
	const snapshots = await db.getAll(...ids.map((id) => db.collection(JOB_COLLECTION).doc(id)));
	return new Map(snapshots.filter((snapshot) => snapshot.exists).map((snapshot) => [snapshot.id, decodeJob(snapshot)]));
}

function algoliaQuery(body) {
	return [body.q, body['company.name']].map((value) => String(value || '').trim()).filter(Boolean).join(' ');
}

async function listAlgolia(body, context) {
	const { limit, tab, hash, sources, isBeta, statuses } = context;
	const cursor = decodeCursor(body.cursor, hash, 'algolia') || { page: 0, offset: 0 };
	let page = Number(cursor.page || 0);
	let offset = Number(cursor.offset || 0);
	let hasMore = true;
	const data = [];
	for (let scannedPages = 0; scannedPages < MAX_SCAN_BATCHES && data.length < limit; scannedPages += 1) {
		const result = await searchNewestJobPage(algoliaQuery(body), { page, hitsPerPage: SCAN_BATCH_SIZE });
		if (!result) throw Object.assign(new Error('Algolia is required for this Job Search filter'), { status: 503, retryable: true });
		const ids = result.ids.slice(offset);
		const jobs = await hydrateJobIds(ids);
		for (let index = 0; index < ids.length; index += 1) {
			const jobId = ids[index];
			offset += 1;
			const job = jobs.get(jobId);
			const row = statuses.get(jobId);
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

async function listStatusIndex(body, context) {
	const { limit, tab, hash, sources, isBeta, statuses, profileId } = context;
	const cursor = decodeCursor(body.cursor, hash, 'statuses');
	let query = getFirestoreDb().collection(STATUS_COLLECTION)
		.where('profileId', '==', profileId)
		.where('visibleInJobSearch', '==', true);
	if (tab !== 'any') query = query.where('state', '==', tab);
	query = query.orderBy('postedAt', 'desc').orderBy('jobId', 'desc');
	if (cursor) query = query.startAfter(new Date(cursor.postedAt), cursor.id);
	const data = [];
	let lastScanned = cursor ? { postedAt: cursor.postedAt, id: cursor.id } : null;
	let hasMore = false;
	for (let batch = 0; batch < MAX_SCAN_BATCHES && data.length < limit; batch += 1) {
		const snapshot = await query.limit(SCAN_BATCH_SIZE).get();
		if (snapshot.empty) { hasMore = false; break; }
		const ids = snapshot.docs.map((document) => String(document.data().jobId));
		const jobs = await hydrateJobIds(ids);
		for (let index = 0; index < snapshot.docs.length; index += 1) {
			const projection = snapshot.docs[index].data();
			const jobId = ids[index];
			lastScanned = { postedAt: asDate(projection.postedAt)?.toISOString() || new Date(0).toISOString(), id: jobId };
			const job = jobs.get(jobId);
			if (!job || !matchesFilters(job, body, { isBeta, sources })) continue;
			data.push(attachViewerStatus(job, statuses.get(jobId)));
			if (data.length === limit) { hasMore = true; break; }
		}
		if (data.length === limit) break;
		if (snapshot.size < SCAN_BATCH_SIZE) { hasMore = false; break; }
		hasMore = true;
		query = getFirestoreDb().collection(STATUS_COLLECTION)
			.where('profileId', '==', profileId)
			.where('visibleInJobSearch', '==', true);
		if (tab !== 'any') query = query.where('state', '==', tab);
		query = query.orderBy('postedAt', 'desc').orderBy('jobId', 'desc')
			.startAfter(new Date(lastScanned.postedAt), lastScanned.id);
	}
	return {
		data,
		hasMore,
		nextCursor: hasMore && lastScanned ? encodeCursor({ v: 1, h: hash, kind: 'statuses', ...lastScanned }) : null,
	};
}

async function approvedCatalogCount(isBeta) {
	const key = isBeta ? 'beta' : 'public';
	const cached = catalogCountCache.get(key);
	if (cached?.expiresAt > Date.now()) return cached.value;
	let value = await readApprovedCatalogCount({ includeExtensionV2: isBeta });
	if (value == null) {
		const filter = isBeta
			? { 'titleReview.label': 'APPROVED' }
			: { 'titleReview.label': 'APPROVED', extensionV2: false };
		value = await jobsCollection.countDocuments(filter);
	}
	catalogCountCache.set(key, { value, expiresAt: Date.now() + COUNT_CACHE_MS });
	return value;
}

export function invalidateJobListV3Counts() {
	catalogCountCache.clear();
	companyCountCache.clear();
}

async function attachCompanyCounts(jobs, isBeta) {
	const ids = [...new Set(jobs.map((job) => String(job.companyId || '').trim()).filter(Boolean))];
	const now = Date.now();
	const counts = new Map();
	await Promise.all(ids.map(async (companyId) => {
		const key = `${isBeta ? 'beta' : 'public'}:${companyId}`;
		const cached = companyCountCache.get(key);
		if (cached?.expiresAt > now) {
			counts.set(companyId, cached.value);
			return;
		}
		let query = getFirestoreDb().collection(JOB_COLLECTION)
			.where('titleReview.label', '==', 'APPROVED')
			.where('companyId', '==', companyId);
		if (!isBeta) query = query.where('extensionV2', '==', false);
		const snapshot = await query.count().get();
		const value = Math.max(0, Number(snapshot.data().count || 0));
		companyCountCache.set(key, { value, expiresAt: now + COUNT_CACHE_MS });
		counts.set(companyId, value);
	}));
	while (companyCountCache.size > 1_000) companyCountCache.delete(companyCountCache.keys().next().value);
	return jobs.map((job) => ({
		...job,
		companyMatchingCount: counts.get(String(job.companyId || '')) ?? 1,
	}));
}

export async function getJobStatusCountsV3(body = {}) {
	const { profileId, isBeta } = await resolveViewer(body);
	const all = await approvedCatalogCount(isBeta);
	if (!profileId) {
		return { all, posted: all, 'bid-ready': 0, 'bid-completed': 0, applied: 0, scheduled: 0, declined: 0 };
	}
	const stored = await readMaterializedJobStatusCounts(profileId, { includeExtensionV2: isBeta });
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

export async function listJobsV3(body = {}) {
	const requestedSort = String(body.sort || 'newest');
	if (!['newest', 'postedAt_desc'].includes(requestedSort)) {
		throw Object.assign(new Error('Job Search supports newest sort only'), { status: 400 });
	}
	const limit = Math.max(1, Math.min(PAGE_LIMIT_MAX, Number(body.limit || 25)));
	const tab = requestedStatus(body);
	const { profileId, isBeta } = await resolveViewer(body);
	const index = await viewerIndex(profileId, tab);
	const statuses = index ? statusMap(index) : new Map();
	const sources = selectedSources(body);
	const hash = cursorHash({ ...body, cursor: undefined, applierName: body.applierName || null });
	const context = { limit, tab, profileId, isBeta, statuses, sources, hash };
	let page;
	if (requiresAlgolia(body, sources)) page = await listAlgolia(body, context);
	else if (!['all', 'new'].includes(tab)) page = await listStatusIndex(body, context);
	else page = await listNative(body, context);
	page.data = await attachCompanyCounts(page.data, isBeta);
	return {
		success: true,
		data: page.data,
		nextCursor: page.nextCursor,
		hasMore: page.hasMore,
		viewerStatus: Object.fromEntries(page.data.map((job) => [String(job._id), job.viewerStatus])),
		statusCounts: await getJobStatusCountsV3(body),
	};
}
