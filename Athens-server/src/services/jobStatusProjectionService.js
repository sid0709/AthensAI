import { createHash, randomUUID } from 'node:crypto';
import { DocumentId } from '@nextoffer/shared/document-id';
import {
	jobStatusContribution,
	mergeJobStatusRows,
	resolveJobStatusState,
} from '@nextoffer/shared/job-status';
import { FieldValue } from 'firebase-admin/firestore';
import { accountInfoCollection, externalScrapedJobsCollection, jobsCollection } from '../db/dataStore.js';
import { isExtensionV2Job } from '../config/jobMarketSchema.js';
import { isBetaTier } from '../lib/betaTier.js';
import { getFirestoreDb } from './firebase/firebaseAdmin.js';
import { JOB_STATUS_STATES, emptyJobStatusBaseline } from './jobStatusModel.js';

const STATUS_COLLECTION = 'job_statuses';
const COUNT_COLLECTION = 'job_status_counts';
const RECEIPT_COLLECTION = 'operation_receipts';
const JOB_COLLECTION = 'job_market';
const EXTERNAL_JOB_COLLECTION = 'external_scraped_jobs';
const COUNTER_SHARDS = 16;
const RECEIPT_TTL_MS = 14 * 24 * 60 * 60 * 1_000;
export const STATUS_PROJECTION_SCHEMA_VERSION = 3;

function clean(value) {
	return String(value ?? '').trim();
}

function asDate(value) {
	if (!value) return null;
	if (value instanceof Date) return value;
	if (typeof value?.toDate === 'function') return value.toDate();
	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function iso(value) {
	return asDate(value)?.toISOString() || null;
}

function documentId(value) {
	try { return new DocumentId(String(value)); } catch { return value; }
}

function nonNegativeInteger(value) {
	const number = Number(value);
	return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

export function stateOf(status = {}) {
	const state = resolveJobStatusState(status);
	return state === 'posted' ? 'other' : state;
}

export function statusContribution(statusOrStatuses = []) {
	const { any: _any, ...contribution } = jobStatusContribution(statusOrStatuses);
	return contribution;
}

export function statesOf(statusOrStatuses = []) {
	const state = resolveJobStatusState(statusOrStatuses);
	return state === 'posted' ? [] : [state];
}

export function canonicalJobCatalog(sourceCatalog) {
	return String(sourceCatalog || 'market').trim().toLowerCase() === 'external' ? 'external' : 'market';
}

function visibleJob(job = {}) {
	return canonicalJobCatalog(job.sourceCatalog) === 'external'
		|| job.titleReview?.label === 'APPROVED';
}

function publicJob(job = {}) {
	return !isExtensionV2Job(job);
}

export function statusRowFromProjection(projection = {}) {
	if (Number(projection.schemaVersion) === 2 && projection.statusRow) {
		const legacy = mergeJobStatusRows([projection.statusRow], projection.profileId);
		return legacy && resolveJobStatusState(legacy) !== 'posted' ? legacy : null;
	}
	if (Number(projection.schemaVersion) !== STATUS_PROJECTION_SCHEMA_VERSION) return null;
	const row = { applier: String(projection.profileId || '') };
	for (const [stored, legacy] of [
		['appliedAt', 'appliedDate'],
		['scheduledAt', 'scheduledDate'],
		['declinedAt', 'declinedDate'],
		['bidReadyAt', 'bidReadyDate'],
		['bidCompletedAt', 'bidCompletedDate'],
	]) {
		const value = iso(projection[stored]);
		if (value) row[legacy] = value;
	}
	return resolveJobStatusState(row) === 'posted' ? null : row;
}

function projectionDates(row = {}) {
	return {
		appliedAt: asDate(row.appliedDate),
		scheduledAt: asDate(row.scheduledDate),
		declinedAt: asDate(row.declinedDate),
		bidReadyAt: asDate(row.bidReadyDate),
		bidCompletedAt: asDate(row.bidCompletedDate),
	};
}

export function jobStatusProjectionId(profileId, jobId) {
	return createHash('sha256').update(`${profileId}\0${jobId}`).digest('hex');
}

function receiptId(profileId, mutationId) {
	return createHash('sha256').update(`${profileId}\0${mutationId}`).digest('hex');
}

function counterShard(jobId) {
	return Number.parseInt(createHash('sha256').update(String(jobId)).digest('hex').slice(0, 8), 16) % COUNTER_SHARDS;
}

function counterRef(profileId, catalog, jobId) {
	const shard = counterShard(jobId);
	return getFirestoreDb().collection(COUNT_COLLECTION).doc(`${profileId}_${catalog}_${String(shard).padStart(2, '0')}`);
}

function contributionForProjection(projection) {
	const row = projection ? statusRowFromProjection(projection) : null;
	if (!row || projection?.visibleInJobSearch !== true) {
		return { any: 0, applied: 0, scheduled: 0, declined: 0, 'bid-ready': 0, 'bid-completed': 0 };
	}
	return jobStatusContribution(row);
}

function contributionDelta(previous, next) {
	const left = contributionForProjection(previous);
	const right = contributionForProjection(next);
	return Object.fromEntries(Object.keys(right).map((key) => [key, Number(right[key] || 0) - Number(left[key] || 0)]));
}

function counterWrite({ profileId, catalog, jobId, previous, next, isPublic }) {
	const delta = contributionDelta(previous, next);
	const nested = Object.fromEntries(Object.entries(delta).map(([key, value]) => [key, FieldValue.increment(value)]));
	const shard = counterShard(jobId);
	return {
		ref: counterRef(profileId, catalog, jobId),
		data: {
			schemaVersion: STATUS_PROJECTION_SCHEMA_VERSION,
			profileId,
			sourceCatalog: catalog,
			shard,
			all: nested,
			...(isPublic ? { public: nested } : {}),
			updatedAt: new Date(),
		},
	};
}

function projectionFromRow({ profileId, jobId, job, row, mutationId, existing = null, now = new Date() }) {
	const state = resolveJobStatusState(row);
	if (state === 'posted') return null;
	return {
		schemaVersion: STATUS_PROJECTION_SCHEMA_VERSION,
		profileId: String(profileId),
		jobId: String(jobId),
		sourceCatalog: canonicalJobCatalog(job?.sourceCatalog),
		state,
		...projectionDates(row),
		postedAt: asDate(job?.postedAt || job?._createdAt || job?.createdAt) || now,
		extensionV2: isExtensionV2Job(job),
		isPublic: publicJob(job),
		visibleInJobSearch: visibleJob(job),
		stateChangedAt: now,
		lastMutationId: mutationId || null,
		createdAt: asDate(existing?.createdAt) || now,
		updatedAt: now,
	};
}

export function buildStatusProjectionData({ profileId, jobId, job, statuses }) {
	const row = mergeJobStatusRows(statuses, profileId);
	return row ? projectionFromRow({ profileId, jobId, job, row, now: new Date() }) : null;
}

export function normalizeMaterializedJobStatusCounts(stored = {}, authoritativeAll = 0, liveStatusCount) {
	const all = nonNegativeInteger(authoritativeAll);
	const any = Math.min(all, nonNegativeInteger(liveStatusCount ?? stored.any));
	return {
		all,
		posted: Math.max(0, all - any),
		...Object.fromEntries(JOB_STATUS_STATES.map((state) => [state, Math.min(any, nonNegativeInteger(stored[state]))])),
	};
}

export async function countLiveProjectedStatusJobs(profileId) {
	if (!clean(profileId)) return null;
	const snapshot = await getFirestoreDb().collection(STATUS_COLLECTION)
		.where('profileId', '==', clean(profileId))
		.where('visibleInJobSearch', '==', true)
		.count()
		.get();
	return nonNegativeInteger(snapshot.data().count);
}

export function invalidateLiveProjectedStatusCount() {
	// Snapshot listeners and Firestore aggregates are authoritative; no Redis cache exists.
}

async function resolveAccount(applierName) {
	if (!accountInfoCollection) return null;
	const name = clean(applierName);
	if (!name) return null;
	let account = await accountInfoCollection.findOne({ name }, { projection: { name: 1, tier: 1 } });
	if (!account) {
		const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		account = await accountInfoCollection.findOne(
			{ name: { $regex: new RegExp(`^${escaped}$`, 'i') } },
			{ projection: { name: 1, tier: 1 } },
		);
	}
	return account ? { id: String(account._id), isBeta: isBetaTier(account.tier), name: account.name } : null;
}

/** Pure state-machine used by Apply, Bid and Pipeline mutations. */
export function reduceJobStatuses(statusRows, profileValue, transition, now = new Date().toISOString()) {
	const profileId = String(profileValue || '');
	const otherRows = [];
	for (const row of Array.isArray(statusRows) ? statusRows : []) {
		if (String(row?.applier || '') !== profileId && row) otherRows.push(row);
	}
	let current = mergeJobStatusRows(statusRows, profileId);
	if (current) current = { ...current, applier: profileId };
	const previous = current ? { ...current } : null;
	const before = current ? JSON.stringify(current) : null;
	const ensure = () => { current ||= { applier: profileId }; };
	switch (transition) {
		case 'apply':
			ensure(); current.appliedDate ||= now; break;
		case 'unapply':
			current = null; break;
		case 'scheduled':
			ensure(); current.appliedDate ||= now; current.scheduledDate = now; delete current.declinedDate; break;
		case 'declined':
			ensure(); current.appliedDate ||= now; current.declinedDate = now; delete current.scheduledDate; break;
		case 'applied':
			ensure(); current.appliedDate ||= now; delete current.scheduledDate; delete current.declinedDate; break;
		case 'bid-ready':
			ensure(); current.bidReadyDate ||= now; break;
		case 'bid-completed':
			ensure(); current.bidReadyDate ||= now; current.bidCompletedDate ||= now; break;
		case 'clear-bid':
			if (current) {
				delete current.bidReadyDate;
				delete current.bidCompletedDate;
				if (!current.appliedDate && !current.scheduledDate && !current.declinedDate) current = null;
			}
			break;
		default:
			throw new Error(`Unsupported job status transition: ${transition}`);
	}
	return {
		statuses: current ? [...otherRows, current] : otherRows,
		current,
		previous,
		changed: before !== (current ? JSON.stringify(current) : null),
	};
}

export async function mutateJobStatus({
	jobId: jobIdRaw,
	applierName,
	transition,
	catalog: catalogRaw = 'market',
	mutationId: mutationIdRaw = null,
}) {
	const jobId = clean(jobIdRaw);
	const catalog = canonicalJobCatalog(catalogRaw);
	const mutationId = clean(mutationIdRaw || randomUUID());
	if (!DocumentId.isValid(jobId)) throw new Error('Invalid job id');
	if (!clean(applierName)) throw new Error('applierName is required');
	if (!mutationId) throw new Error('mutationId is required');
	const account = await resolveAccount(applierName);
	if (!account) throw new Error(`User ${applierName} not found`);
	const profileId = account.id;
	const firestore = getFirestoreDb();
	const jobRef = firestore.collection(catalog === 'external' ? EXTERNAL_JOB_COLLECTION : JOB_COLLECTION).doc(jobId);
	const statusRef = firestore.collection(STATUS_COLLECTION).doc(jobStatusProjectionId(profileId, jobId));
	const receiptRef = firestore.collection(RECEIPT_COLLECTION).doc(receiptId(profileId, mutationId));
	const now = new Date();

	const result = await firestore.runTransaction(async (transaction) => {
		const [jobSnapshot, statusSnapshot, receiptSnapshot] = await Promise.all([
			transaction.get(jobRef),
			transaction.get(statusRef),
			transaction.get(receiptRef),
		]);
		if (!jobSnapshot.exists) {
			throw new Error('Job not found');
		}
		const job = { ...jobSnapshot.data(), sourceCatalog: catalog };
		if ((!account.isBeta && isExtensionV2Job(job)) || !visibleJob(job)) throw new Error('Job not found');
		const existing = statusSnapshot.exists ? statusSnapshot.data() : null;
		if (receiptSnapshot.exists) {
			const receipt = receiptSnapshot.data();
			if (receipt.jobId !== jobId || receipt.transition !== transition) {
				throw new Error('mutationId was already used for another status change');
			}
			return { changed: false, duplicate: true, projection: existing };
		}
		const previousRow = (existing ? statusRowFromProjection(existing) : null)
			|| mergeJobStatusRows(job.status, profileId);
		const reduced = reduceJobStatuses(previousRow ? [previousRow] : [], profileId, transition, now.toISOString());
		const next = reduced.current
			? projectionFromRow({ profileId, jobId, job, row: reduced.current, mutationId, existing, now })
			: null;
		const count = counterWrite({
			profileId,
			catalog,
			jobId,
			previous: existing,
			next,
			isPublic: publicJob(job),
		});
		if (next) transaction.set(statusRef, next, { merge: false });
		else transaction.delete(statusRef);
		transaction.set(count.ref, count.data, { merge: true });
		transaction.create(receiptRef, {
			schemaVersion: 1,
			profileId,
			jobId,
			transition,
			mutationId,
			state: next?.state || 'posted',
			createdAt: now,
			expiresAt: new Date(now.getTime() + RECEIPT_TTL_MS),
		});
		return { changed: reduced.changed, duplicate: false, projection: next };
	});
	const viewerStatusDates = result.projection ? statusRowFromProjection(result.projection) : null;
	const collection = catalog === 'external' ? externalScrapedJobsCollection : jobsCollection;
	const job = await collection?.findOne({ _id: new DocumentId(jobId) });
	return {
		job: { ...(job || { _id: new DocumentId(jobId) }), status: viewerStatusDates ? [viewerStatusDates] : [] },
		changed: result.changed,
		profileId,
		catalog,
		mutationId,
		statusVersion: `${now.getTime()}:${mutationId}`,
		viewerStatus: result.projection?.state || 'posted',
		viewerStatusDates,
		cacheSync: 'firestore',
	};
}

const MAX_BULK_STATUS_JOBS = 150;

export function normalizeBulkStatusJobs(jobs = []) {
	const seen = new Set();
	const normalized = [];
	for (const value of Array.isArray(jobs) ? jobs : []) {
		const jobId = clean(value?.id);
		if (!DocumentId.isValid(jobId) || seen.has(jobId)) continue;
		seen.add(jobId);
		normalized.push({ jobId, catalog: canonicalJobCatalog(value?.catalog) });
		if (normalized.length >= MAX_BULK_STATUS_JOBS) break;
	}
	return normalized;
}

export async function mutateJobStatusesBulk({ jobs, applierName, transition, bulkMutationId: rawId = null }) {
	const targets = normalizeBulkStatusJobs(jobs);
	const bulkMutationId = clean(rawId || randomUUID());
	if (!targets.length) throw new Error('jobs are required');
	if (!['bid-ready', 'clear-bid'].includes(transition)) throw new Error('Unsupported bulk status transition');
	const results = [];
	const failed = [];
	for (let offset = 0; offset < targets.length; offset += 10) {
		const chunk = targets.slice(offset, offset + 10);
		const settled = await Promise.allSettled(chunk.map((target) => mutateJobStatus({
			jobId: target.jobId,
			catalog: target.catalog,
			applierName,
			transition,
			mutationId: createHash('sha256').update(`${bulkMutationId}:${target.jobId}:${transition}`).digest('hex'),
		})));
		settled.forEach((entry, index) => {
			if (entry.status === 'fulfilled') results.push({ jobId: chunk[index].jobId, ...entry.value });
			else failed.push({ jobId: chunk[index].jobId, error: entry.reason?.message || String(entry.reason) });
		});
	}
	return { profileId: results[0]?.profileId || null, results, failed, cacheSync: 'firestore' };
}

function validProjection(profileId, raw) {
	return raw
		&& Number(raw.schemaVersion) === STATUS_PROJECTION_SCHEMA_VERSION
		&& String(raw.profileId || '') === String(profileId)
		&& JOB_STATUS_STATES.includes(String(raw.state || ''))
		&& statusRowFromProjection(raw);
}

export function authoritativeJobStatusBaseline(profileId, projectionRows = [], canonicalJobsById = new Map()) {
	const baseline = emptyJobStatusBaseline();
	for (const raw of projectionRows || []) {
		const row = raw?.data instanceof Function ? raw.data() : raw;
		if (!validProjection(profileId, row)) continue;
		const jobId = String(row.jobId || '');
		const canonical = canonicalJobsById.get(jobId);
		const state = canonical ? resolveJobStatusState(canonical.status, profileId) : row.state;
		if (JOB_STATUS_STATES.includes(state)) baseline[state].push(jobId);
	}
	for (const state of JOB_STATUS_STATES) baseline[state] = [...new Set(baseline[state])];
	return baseline;
}

export function canonicalProjectedJobStatusIdsByState(profileId, states = [], projectionRows = []) {
	const requested = [...new Set((Array.isArray(states) ? states : [states]).filter((state) => JOB_STATUS_STATES.includes(state)))];
	const grouped = new Map(requested.map((state) => [state, []]));
	for (const raw of projectionRows || []) {
		const row = raw?.data instanceof Function ? raw.data() : raw;
		if (!validProjection(profileId, row) || !grouped.has(row.state)) continue;
		grouped.get(row.state).push({ jobId: String(row.jobId), postedAt: iso(row.postedAt) || '' });
	}
	for (const [state, entries] of grouped) {
		grouped.set(state, entries
			.sort((a, b) => Date.parse(b.postedAt || 0) - Date.parse(a.postedAt || 0) || b.jobId.localeCompare(a.jobId))
			.map((entry) => entry.jobId));
	}
	return grouped;
}

export function canonicalProjectedStatusIds(profileId, state, projectionRows = []) {
	return canonicalProjectedJobStatusIdsByState(profileId, [state], projectionRows).get(state) || [];
}

export async function readCanonicalProjectedJobStatusIdsByState(profileId, states = []) {
	const snapshot = await getFirestoreDb().collection(STATUS_COLLECTION)
		.where('profileId', '==', String(profileId))
		.get();
	return canonicalProjectedJobStatusIdsByState(profileId, states, snapshot.docs);
}

export async function readCanonicalProjectedJobStatusIds(profileId, state) {
	return (await readCanonicalProjectedJobStatusIdsByState(profileId, [state])).get(state) || [];
}

export async function readMaterializedJobStatusIdsByState(profileId, states = JOB_STATUS_STATES) {
	return readCanonicalProjectedJobStatusIdsByState(profileId, states);
}

export async function readMaterializedJobStatusIds(profileId, state) {
	if (state === 'any') {
		const grouped = await readCanonicalProjectedJobStatusIdsByState(profileId, JOB_STATUS_STATES);
		return [...new Set(JOB_STATUS_STATES.flatMap((item) => grouped.get(item) || []))];
	}
	return readCanonicalProjectedJobStatusIds(profileId, state);
}

export async function readProjectedJobStatuses(profileId, jobIds = []) {
	const ids = [...new Set((jobIds || []).map(String).filter(Boolean))];
	if (!profileId || !ids.length) return new Map();
	const firestore = getFirestoreDb();
	const result = new Map();
	for (let offset = 0; offset < ids.length; offset += 250) {
		const chunk = ids.slice(offset, offset + 250);
		const snapshots = await firestore.getAll(...chunk.map((jobId) => (
			firestore.collection(STATUS_COLLECTION).doc(jobStatusProjectionId(profileId, jobId))
		)));
		snapshots.forEach((snapshot, index) => {
			const row = snapshot.exists ? statusRowFromProjection(snapshot.data()) : null;
			if (row) result.set(chunk[index], [row]);
		});
	}
	return result;
}

export async function publishStatusCache() {
	// Retained as a compatibility no-op while callers migrate from Redis naming.
	return true;
}

export async function readMaterializedJobStatusCounts(profileId, { includeExtensionV2 = true } = {}) {
	if (!clean(profileId)) return null;
	const snapshot = await getFirestoreDb().collection(COUNT_COLLECTION)
		.where('profileId', '==', clean(profileId))
		.get();
	const field = includeExtensionV2 ? 'all' : 'public';
	const counts = { any: 0, applied: 0, scheduled: 0, declined: 0, 'bid-ready': 0, 'bid-completed': 0 };
	for (const document of snapshot.docs) {
		const values = document.data()?.[field] || {};
		for (const key of Object.keys(counts)) counts[key] += nonNegativeInteger(values[key]);
	}
	return counts;
}

/** Reconcile status visibility after Title Review approval or quarantine. */
export async function syncJobStatusVisibility(jobIds = []) {
	const ids = [...new Set((jobIds || []).map(clean).filter((id) => DocumentId.isValid(id)))];
	if (!ids.length) return { jobs: 0, statuses: 0 };
	const firestore = getFirestoreDb();
	let statuses = 0;
	for (const jobId of ids) {
		const jobSnapshot = await firestore.collection(JOB_COLLECTION).doc(jobId).get();
		const job = jobSnapshot.exists ? jobSnapshot.data() : null;
		const visibleInJobSearch = job ? visibleJob(job) : false;
		const statusSnapshots = await firestore.collection(STATUS_COLLECTION).where('jobId', '==', jobId).get();
		for (const statusDocument of statusSnapshots.docs) {
			const changed = await firestore.runTransaction(async (transaction) => {
				const currentSnapshot = await transaction.get(statusDocument.ref);
				if (!currentSnapshot.exists) return false;
				const previous = currentSnapshot.data();
				if (previous.visibleInJobSearch === visibleInJobSearch) return false;
				const next = {
					...previous,
					visibleInJobSearch,
					isPublic: job ? publicJob(job) : previous.isPublic === true,
					extensionV2: job ? isExtensionV2Job(job) : previous.extensionV2 === true,
					postedAt: asDate(job?.postedAt || job?._createdAt || job?.createdAt) || previous.postedAt || new Date(),
					updatedAt: new Date(),
				};
				const count = counterWrite({
					profileId: String(previous.profileId),
					catalog: canonicalJobCatalog(previous.sourceCatalog),
					jobId,
					previous,
					next,
					isPublic: next.isPublic,
				});
				transaction.set(statusDocument.ref, next, { merge: false });
				transaction.set(count.ref, count.data, { merge: true });
				return true;
			});
			if (changed) statuses += 1;
		}
	}
	return { jobs: ids.length, statuses };
}

export async function syncJobStatusProjection(jobIdRaw, profileIdRaw) {
	const jobId = clean(jobIdRaw);
	const profileId = clean(profileIdRaw);
	if (!jobId || !profileId || !jobsCollection) return false;
	const job = await jobsCollection.findOne(
		{ _id: documentId(jobId) },
		{ projection: { status: 1, postedAt: 1, sourceCatalog: 1, version: 1, extensionV2: 1, titleReview: 1 } },
	);
	if (!job) return false;
	const row = mergeJobStatusRows(job.status, profileId);
	const ref = getFirestoreDb().collection(STATUS_COLLECTION).doc(jobStatusProjectionId(profileId, jobId));
	if (!row || resolveJobStatusState(row) === 'posted') await ref.delete();
	else await ref.set(projectionFromRow({ profileId, jobId, job, row, now: new Date() }), { merge: false });
	return true;
}

function stateFromBody(body = {}) {
	if (!(body.applied === true || body.applied === 'true')) return null;
	return ({
		Applied: 'applied', Scheduled: 'scheduled', Declined: 'declined',
		BidReady: 'bid-ready', BidCompleted: 'bid-completed',
	})[body.status] || null;
}

async function hydrateJobs(ids, profileId) {
	if (!ids.length || !jobsCollection) return [];
	const jobs = await jobsCollection.find({ _id: { $in: ids.map(documentId) } }).toArray();
	const statuses = await readProjectedJobStatuses(profileId, ids);
	return jobs
		.filter(visibleJob)
		.map((job) => ({ ...job, status: statuses.get(String(job._id)) || [] }));
}

export async function listMaterializedJobStatusPage(body = {}) {
	const state = stateFromBody(body);
	if (!state || !body.applierName) return null;
	const account = await resolveAccount(body.applierName);
	if (!account) return null;
	const page = Math.max(1, Number(body.page || 1));
	const limit = Math.max(1, Math.min(500, Number(body.limit || 25)));
	const direction = String(body.sort || '').endsWith('_asc') ? 'asc' : 'desc';
	let query = getFirestoreDb().collection(STATUS_COLLECTION)
		.where('profileId', '==', account.id)
		.where('visibleInJobSearch', '==', true)
		.where('state', '==', state)
		.orderBy('postedAt', direction)
		.orderBy('jobId', direction);
	const totalSnapshot = await query.count().get();
	query = query.offset((page - 1) * limit).limit(limit);
	const snapshot = await query.get();
	const ids = snapshot.docs.map((doc) => String(doc.data().jobId));
	const docs = await hydrateJobs(ids, account.id);
	const byId = new Map(docs.map((job) => [String(job._id), job]));
	return {
		docs: ids.map((id) => byId.get(id)).filter(Boolean),
		total: Number(totalSnapshot.data().count || 0),
		page,
		limit,
	};
}

export async function listMaterializedPostedPage() {
	// Newest cursor pagination is implemented by Job Search v3.
	return null;
}

export function canUseMaterializedStatusPageForTier() {
	return true;
}
