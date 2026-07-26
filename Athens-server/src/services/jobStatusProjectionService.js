import { createHash } from "node:crypto";
import { ObjectId } from "mongodb";
import { accountInfoCollection, jobsCollection } from "../db/mongo.js";
import { JobSourceTitles } from "../config/jobSources.js";
import { JOB_LIST_PROJECTION } from "./jobListQuery.js";
import { getFirestoreDb } from "./firebase/firebaseAdmin.js";
import { bumpStatusRevision } from "./matching/rankingCache.js";
import { getRedis, isRedisReady } from "../db/redis.js";
import { isBetaTier } from "../lib/betaTier.js";

const COUNTER_FIELDS = ["rawApplied", "applied", "scheduled", "declined", "bid-ready", "bid-completed"];
const STATUS_CACHE_TTL_SEC = 60 * 60;
const STATUS_CACHE_EMPTY = '-';

function enabled() {
  return String(process.env.DATABASE_BACKEND || "").trim().toLowerCase() === "firestore";
}

export function stateOf(status = {}) {
	if (status.bidCompletedDate) return "bid-completed";
	if (status.scheduledDate) return "scheduled";
	if (status.declinedDate) return "declined";
	if (status.appliedDate) return "applied";
	if (status.bidReadyDate) return "bid-ready";
	return "other";
}

export function statusContribution(statusOrStatuses = []) {
	const statuses = (Array.isArray(statusOrStatuses) ? statusOrStatuses : [statusOrStatuses]).filter(Boolean);
	const has = (predicate) => Number(statuses.some(predicate));
	return {
		rawApplied: has((status) => Boolean(status.appliedDate)),
		applied: has((status) => Boolean(status.appliedDate) && !status.scheduledDate && !status.declinedDate),
		scheduled: has((status) => Boolean(status.scheduledDate)),
		declined: has((status) => Boolean(status.declinedDate)),
		"bid-ready": has((status) => Boolean(status.bidReadyDate) && !status.bidCompletedDate && !status.appliedDate && !status.scheduledDate && !status.declinedDate),
		"bid-completed": has((status) => Boolean(status.bidCompletedDate) && !status.appliedDate && !status.scheduledDate && !status.declinedDate),
	};
}

export function statesOf(statusOrStatuses = []) {
	const contribution = statusContribution(statusOrStatuses);
	return ["bid-completed", "scheduled", "declined", "applied", "bid-ready"]
		.filter((state) => contribution[state] > 0);
}

function projectionId(profileId, jobId) {
  return createHash("sha256").update(`${profileId}\0${jobId}`).digest("hex");
}

function statusCacheKey(profileId, jobId) {
  return `ranking:v2:job-status:${String(profileId)}:${String(jobId)}`;
}

function statusCountsCacheKey(profileId) {
  return `ranking:v2:job-status-counts:${String(profileId)}`;
}

function projectedStatusRow(profileId, row = {}) {
  return {
    applier: String(profileId),
    appliedDate: row.appliedDate || undefined,
    scheduledDate: row.scheduledDate || undefined,
    declinedDate: row.declinedDate || undefined,
    bidReadyDate: row.bidReadyDate || undefined,
    bidCompletedDate: row.bidCompletedDate || undefined,
  };
}

function emptyCounts(profileId, all) {
	return {
		profileId, all, posted: all, any: 0, rawApplied: 0, applied: 0,
		scheduled: 0, declined: 0, "bid-ready": 0, "bid-completed": 0,
		other: 0, jobIdsByState: {},
	};
}

function stateFromBody(body = {}) {
	if (!(body.applied === true || body.applied === "true")) return null;
	return ({
		Applied: "applied",
		Scheduled: "scheduled",
		Declined: "declined",
		BidReady: "bid-ready",
		BidCompleted: "bid-completed",
	})[body.status] || null;
}

function hasUnsupportedStatusPageFilters(body = {}) {
	const ignored = new Set([
		"applierName", "applied", "status", "sort", "page", "limit", "skip",
		"includeExternalScraped", "jobSources",
	]);
	if (body.jobSources) {
		const selected = new Set(String(body.jobSources).split(",").map((value) => value.trim()).filter(Boolean));
		if (!JobSourceTitles.every((source) => selected.has(source))) return true;
	}
	return Object.entries(body).some(([key, value]) => {
		if (ignored.has(key)) return false;
		if (Array.isArray(value)) return value.length > 0;
		return value !== undefined && value !== null && value !== "" && value !== false;
	});
}

export async function listMaterializedJobStatusPage(body = {}) {
	if (!enabled() || !jobsCollection || !accountInfoCollection || !body.applierName) return null;
	const state = stateFromBody(body);
	if (!state || hasUnsupportedStatusPageFilters(body)) return null;
	const account = await accountInfoCollection.findOne(
		{ name: String(body.applierName).trim() },
		{ projection: { _id: 1, tier: 1 } },
	);
	if (!account?._id) return null;
	// This global projection contains beta-only jobs, so non-beta users take the
	// normal tier-filtered database path.
	if (!canUseMaterializedStatusPageForTier(account.tier)) return null;
	const counts = await readMaterializedJobStatusCounts(String(account._id));
	const sourceIds = counts?.jobIdsByState?.[state];
	if (!Array.isArray(sourceIds)) return null;

	const page = Math.max(1, Number.parseInt(body.page, 10) || 1);
	const limit = Math.max(1, Math.min(5000, Number.parseInt(body.limit, 10) || 10));
	const skip = body.skip !== undefined && body.skip !== null && body.skip !== ""
		? Math.max(0, Number.parseInt(body.skip, 10) || 0)
		: (page - 1) * limit;
	const orderedIds = String(body.sort || "").toLowerCase() === "postedat_asc" ? [...sourceIds].reverse() : sourceIds;
	const pageIds = orderedIds.slice(skip, skip + limit);
	const objectIds = pageIds.map((id) => {
		try { return new ObjectId(id); } catch { return id; }
	});
	const docs = objectIds.length
		? await jobsCollection.find({ _id: { $in: objectIds } }, { projection: JOB_LIST_PROJECTION }).toArray()
		: [];
	const byId = new Map(docs.map((doc) => [String(doc._id), doc]));
	return {
		docs: pageIds.map((id) => byId.get(String(id))).filter(Boolean),
		total: sourceIds.length,
		page,
		limit,
		state,
	};
}

export function canUseMaterializedStatusPageForTier(tier) {
	return isBetaTier(tier);
}

export async function syncJobStatusProjection(jobIdRaw, profileIdRaw) {
  const jobId = String(jobIdRaw || "");
  const profileId = String(profileIdRaw || "");
  if (!jobId || !profileId) return false;
  await bumpStatusRevision(profileId);
  if (!enabled() || !jobsCollection) return true;
  let objectId;
  try { objectId = new ObjectId(jobId); } catch { objectId = jobId; }
  const job = await jobsCollection.findOne({ _id: objectId }, { projection: { status: 1, postedAt: 1, sourceCatalog: 1 } });
  if (!job) return false;
	const statuses = (Array.isArray(job.status) ? job.status : []).filter((row) => String(row?.applier || "") === profileId);
  const firestore = getFirestoreDb();
  const statusRef = firestore.collection("job_statuses").doc(projectionId(profileId, jobId));
  const countsRef = firestore.collection("job_status_counts").doc(profileId);
  const total = (await firestore.collection("jobs").count().get()).data().count;

  await firestore.runTransaction(async (transaction) => {
    const [existingStatus, existingCounts] = await Promise.all([transaction.get(statusRef), transaction.get(countsRef)]);
		const previous = existingStatus.exists ? existingStatus.data() : null;
		const previousState = previous ? String(previous.state || "other") : null;
		const states = statesOf(statuses);
		const nextState = states[0] || (statuses.length ? "other" : null);
		const counts = { ...emptyCounts(profileId, total), ...(existingCounts.exists ? existingCounts.data() : {}) };
		counts.jobIdsByState = { ...(counts.jobIdsByState || {}) };
		counts.all = total;
		for (const key of [...COUNTER_FIELDS, "other"]) counts[key] = Number(counts[key] || 0);
		counts.any = Number(counts.any || 0);
		const before = previous?.contribution || statusContribution(null);
		const after = statusContribution(statuses);
		for (const key of COUNTER_FIELDS) counts[key] = Math.max(0, counts[key] - Number(before[key] || 0) + Number(after[key] || 0));
		if (previousState === "other") counts.other = Math.max(0, counts.other - 1);
		if (nextState === "other") counts.other += 1;
		if (!previous && statuses.length) counts.any += 1;
		if (previous && !statuses.length) counts.any = Math.max(0, counts.any - 1);
		counts.posted = Math.max(0, total - counts.any);
		for (const state of ["applied", "scheduled", "declined", "bid-ready", "bid-completed"]) {
			const ids = Array.isArray(counts.jobIdsByState[state]) ? counts.jobIdsByState[state].filter((id) => String(id) !== jobId) : [];
			if (states.includes(state)) ids.unshift(jobId);
			counts.jobIdsByState[state] = ids;
		}
    counts.updatedAt = new Date();
    transaction.set(countsRef, counts, { merge: false });
		if (statuses.length) {
      transaction.set(statusRef, {
        profileId,
        jobId,
			state: nextState,
			states,
        sourceCatalog: job.sourceCatalog || "market",
        postedAt: job.postedAt || null,
			appliedDate: statuses.find((status) => status.appliedDate)?.appliedDate || null,
			scheduledDate: statuses.find((status) => status.scheduledDate)?.scheduledDate || null,
			declinedDate: statuses.find((status) => status.declinedDate)?.declinedDate || null,
			bidReadyDate: statuses.find((status) => status.bidReadyDate)?.bidReadyDate || null,
			bidCompletedDate: statuses.find((status) => status.bidCompletedDate)?.bidCompletedDate || null,
				contribution: after,
        updatedAt: new Date(),
      }, { merge: false });
    } else transaction.delete(statusRef);
  });

	if (statuses.length) await jobsCollection.updateOne({ _id: objectId }, { $addToSet: { statusProfileIds: profileId } });
	else await jobsCollection.updateOne({ _id: objectId }, { $pull: { statusProfileIds: profileId } });
  if (isRedisReady()) {
    await getRedis().del(statusCountsCacheKey(profileId));
    const value = statuses.length
      ? JSON.stringify(projectedStatusRow(profileId, statuses.reduce((merged, row) => ({ ...merged, ...row }), {})))
      : STATUS_CACHE_EMPTY;
    await getRedis().setEx(statusCacheKey(profileId, jobId), STATUS_CACHE_TTL_SEC, value);
  }
  return true;
}

export async function readMaterializedJobStatusCounts(profileId) {
  if (!enabled() || !profileId) return null;
  if (isRedisReady()) {
    const cached = await getRedis().get(statusCountsCacheKey(profileId));
    if (cached) {
      try { return JSON.parse(cached); } catch { /* reload */ }
    }
  }
  const snapshot = await getFirestoreDb().collection("job_status_counts").doc(String(profileId)).get();
  const counts = snapshot.exists ? snapshot.data() : null;
  if (counts && isRedisReady()) {
    await getRedis().setEx(statusCountsCacheKey(profileId), STATUS_CACHE_TTL_SEC, JSON.stringify(counts));
  }
  return counts;
}

export async function readProjectedJobStatuses(profileId, jobIds = []) {
  if (!enabled() || !profileId || !jobIds.length) return new Map();
  const ids = [...new Set(jobIds.map(String))];
  const values = isRedisReady()
    ? await getRedis().mGet(ids.map((jobId) => statusCacheKey(profileId, jobId)))
    : ids.map(() => null);
  const statuses = new Map();
  const missingIds = [];
  values.forEach((value, index) => {
    if (value == null) {
      missingIds.push(ids[index]);
      return;
    }
    if (value === STATUS_CACHE_EMPTY) return;
    try {
      statuses.set(ids[index], [JSON.parse(value)]);
    } catch {
      missingIds.push(ids[index]);
    }
  });
  if (!missingIds.length) return statuses;
  const counts = await readMaterializedJobStatusCounts(profileId);
  const stateIds = new Set(
    Object.values(counts?.jobIdsByState || {})
      .flatMap((stateJobIds) => Array.isArray(stateJobIds) ? stateJobIds : [])
      .map(String),
  );
  const exactMissingIds = counts?.jobIdsByState
    ? missingIds.filter((jobId) => stateIds.has(jobId))
    : missingIds;
  const knownEmptyIds = counts?.jobIdsByState
    ? missingIds.filter((jobId) => !stateIds.has(jobId))
    : [];
  const firestore = getFirestoreDb();
  const refs = exactMissingIds.map((jobId) => firestore
    .collection('job_statuses')
    .doc(projectionId(String(profileId), String(jobId))));
  const snapshots = refs.length ? await firestore.getAll(...refs) : [];
  const cacheWrites = [];
  for (let index = 0; index < snapshots.length; index += 1) {
    const snapshot = snapshots[index];
    const jobId = exactMissingIds[index];
    const row = snapshot.exists ? projectedStatusRow(profileId, snapshot.data()) : null;
    if (row) statuses.set(jobId, [row]);
    if (isRedisReady()) {
      cacheWrites.push(getRedis().setEx(
        statusCacheKey(profileId, jobId),
        STATUS_CACHE_TTL_SEC,
        row ? JSON.stringify(row) : STATUS_CACHE_EMPTY,
      ));
    }
  }
  if (isRedisReady()) {
    cacheWrites.push(...knownEmptyIds.map((jobId) => getRedis().setEx(
      statusCacheKey(profileId, jobId),
      STATUS_CACHE_TTL_SEC,
      STATUS_CACHE_EMPTY,
    )));
  }
  if (cacheWrites.length) await Promise.all(cacheWrites);
  return statuses;
}
