import { createHash } from "node:crypto";
import { ObjectId } from "mongodb";
import { FieldValue } from "firebase-admin/firestore";
import {
	jobStatusContribution,
	mergeJobStatusRows,
	resolveJobStatusState,
} from "@nextoffer/shared/job-status";
import { accountInfoCollection, jobsCollection } from "../db/mongo.js";
import { JobSourceTitles } from "../config/jobSources.js";
import { buildJobsListQuery, JOB_LIST_PROJECTION, resolveApplierContext } from "./jobListQuery.js";
import { getFirestoreDb } from "./firebase/firebaseAdmin.js";
import { bumpStatusRevision } from "./matching/rankingCache.js";
import { getRedis, isRedisReady } from "../db/redis.js";
import { isBetaTier } from "../lib/betaTier.js";
import { excludeExtensionV2JobsFilter, isExtensionV2Job } from "../config/jobMarketSchema.js";
import { readDateTailPage } from "./matching/jobRankingIndex.js";
import { getJobRankingPoints } from "./vectorStore/qdrantClient.js";

const STATUS_CACHE_TTL_SEC = 60 * 60;
// Numeric counters are mutation-maintained and rebased onto the live catalog,
// so they should survive normal Redis-backed app restarts instead of flashing
// zero every minute while the legacy migration snapshot reloads.
const STATUS_COUNTS_CACHE_TTL_SEC = 7 * 24 * 60 * 60;
const STATUS_CACHE_EMPTY = '-';
export const STATUS_PROJECTION_SCHEMA_VERSION = 2;
const STATUS_BASELINE_CACHE_TTL_SEC = 7 * 24 * 60 * 60;
const LIVE_STATUS_COUNT_TTL_MS = 60_000;
const liveStatusCountCache = new Map();
const statusCountWarmups = new Map();
const statusIdBaselineCache = new Map();
const STATUS_STATES = ["applied", "scheduled", "declined", "bid-ready", "bid-completed"];

function enabled() {
  return String(process.env.DATABASE_BACKEND || "").trim().toLowerCase() === "firestore";
}

export function stateOf(status = {}) {
	const state = resolveJobStatusState(status);
	return state === "posted" ? "other" : state;
}

export function statusContribution(statusOrStatuses = []) {
	const { any: _any, ...contribution } = jobStatusContribution(statusOrStatuses);
	return contribution;
}

export function statesOf(statusOrStatuses = []) {
	const state = resolveJobStatusState(statusOrStatuses);
	return state === "posted" ? [] : [state];
}

function nonNegativeInteger(value) {
	const number = Number(value);
	return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

/**
 * Materialized status rows outlive catalog inserts/deletes, so their `all` and
 * `posted` fields are only snapshots. Rebase them onto the authoritative live
 * market count and the live per-profile status index before returning them.
 */
export function normalizeMaterializedJobStatusCounts(stored = {}, authoritativeAll = 0, liveStatusCount) {
	const all = nonNegativeInteger(authoritativeAll);
	const fallbackAny = stored.any ?? (
		nonNegativeInteger(stored.all) - nonNegativeInteger(stored.posted)
	);
	const any = Math.min(all, nonNegativeInteger(liveStatusCount ?? fallbackAny));
	const normalized = { all, posted: Math.max(0, all - any) };
	for (const key of ["bid-ready", "bid-completed", "applied", "scheduled", "declined"]) {
		normalized[key] = Math.min(any, nonNegativeInteger(stored[key]));
	}
	return normalized;
}

/** Count live market jobs carrying any status for one profile. */
export async function countLiveProjectedStatusJobs(profileId) {
	if (!enabled() || !profileId) return null;
	const key = String(profileId);
	const cached = liveStatusCountCache.get(key);
	if (cached?.expiresAt > Date.now()) return cached.promise;
	const promise = getFirestoreDb()
		.collection("job_statuses")
		.where("profileId", "==", key)
		.count()
		.get()
		.then((snapshot) => nonNegativeInteger(snapshot.data().count))
		.catch((error) => {
			liveStatusCountCache.delete(key);
			throw error;
		});
	liveStatusCountCache.set(key, { promise, expiresAt: Date.now() + LIVE_STATUS_COUNT_TTL_MS });
	return promise;
}

export function invalidateLiveProjectedStatusCount(profileId) {
	if (profileId) liveStatusCountCache.delete(String(profileId));
	else liveStatusCountCache.clear();
}

export function jobStatusProjectionId(profileId, jobId) {
  return createHash("sha256").update(`${profileId}\0${jobId}`).digest("hex");
}

function statusBackendNamespace() {
	return String(process.env.DATABASE_BACKEND || 'mongo').trim().toLowerCase() === 'firestore'
		? 'firestore'
		: 'mongo';
}

function statusCacheKey(profileId, jobId) {
  return `ranking:v5:job-status:${statusBackendNamespace()}:${String(profileId)}:${String(jobId)}`;
}

function statusCountsCacheKey(profileId, includeExtensionV2 = true) {
	return `ranking:v5:job-status-counts:${statusBackendNamespace()}:${String(profileId)}:${includeExtensionV2 ? "all" : "public"}`;
}

function statusCountsPendingKey(profileId, includeExtensionV2 = true) {
	return `${statusCountsCacheKey(profileId, includeExtensionV2)}:pending`;
}

function statusAddedKey(profileId, state) {
	return `ranking:v5:job-status-ids:${statusBackendNamespace()}:${String(profileId)}:${state}:added`;
}

function statusRemovedKey(profileId, state) {
	return `ranking:v5:job-status-ids:${statusBackendNamespace()}:${String(profileId)}:${state}:removed`;
}

function statusBaselineCacheKey(profileId) {
	return `ranking:v5:job-status-ids:${statusBackendNamespace()}:${String(profileId)}:baseline`;
}

function canonicalStatusRow(profileId, row = {}) {
	const canonical = { applier: String(profileId) };
	for (const field of ["appliedDate", "scheduledDate", "declinedDate", "bidReadyDate", "bidCompletedDate"]) {
		if (!row[field]) continue;
		const raw = row[field];
		const date = raw instanceof Date
			? raw
			: typeof raw?.toDate === "function"
				? raw.toDate()
				: new Date(raw);
		canonical[field] = Number.isNaN(date.getTime()) ? String(raw) : date.toISOString();
	}
	return canonical;
}

function statusFingerprint(row) {
	const canonical = canonicalStatusRow(row?.applier, row);
	return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function projectedStatusRow(profileId, projection = {}) {
	if (Number(projection.schemaVersion) !== STATUS_PROJECTION_SCHEMA_VERSION) return null;
	if (!projection.statusRow || typeof projection.statusRow !== "object") return null;
	const row = canonicalStatusRow(profileId, projection.statusRow);
	if (projection.statusFingerprint !== statusFingerprint(row)) return null;
	return row;
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
	if (!jobsCollection || !accountInfoCollection || !body.applierName) return null;
	const state = stateFromBody(body);
	if (!state) return null;
	let hasGlobalFilters = hasUnsupportedStatusPageFilters(body);
	const account = await resolveApplierContext(String(body.applierName).trim());
	if (!account?.id) return null;
	// Non-beta profiles always hydrate through the tier-filtered authoritative
	// query so an old status projection can never reveal an extension-v2 job.
	if (!account.isBeta) hasGlobalFilters = true;
	const profileId = String(account.id);
	const page = Math.max(1, Number.parseInt(body.page, 10) || 1);
	const limit = Math.max(1, Math.min(5000, Number.parseInt(body.limit, 10) || 10));
	const skip = body.skip !== undefined && body.skip !== null && body.skip !== ""
		? Math.max(0, Number.parseInt(body.skip, 10) || 0)
		: (page - 1) * limit;
	const direction = String(body.sort || "").toLowerCase() === "postedat_asc" ? "asc" : "desc";
	const statusIds = await readMaterializedJobStatusIds(profileId, state);
	let orderedIds = direction === "asc" ? [...statusIds].reverse() : statusIds;
	let total = statusIds.length;
	let preloadedDocs = [];
	if (hasGlobalFilters) {
		const { query: globalQuery } = await buildJobsListQuery(body, { includePersonalStatus: false });
		for (let start = 0; start < orderedIds.length; start += 250) {
			const chunkIds = orderedIds.slice(start, start + 250).map((id) => new ObjectId(id));
			preloadedDocs.push(...await jobsCollection.find(
				{ $and: [globalQuery, { _id: { $in: chunkIds } }] },
				{ projection: JOB_LIST_PROJECTION },
			).toArray());
		}
		preloadedDocs.sort((left, right) => {
			const delta = (Date.parse(right.postedAt || 0) || 0) - (Date.parse(left.postedAt || 0) || 0);
			return direction === "asc" ? -delta : delta;
		});
		orderedIds = preloadedDocs.map((doc) => String(doc._id));
		total = orderedIds.length;
	}
	const pageIds = orderedIds.slice(skip, skip + limit);
	const objectIds = pageIds.map((id) => {
		try { return new ObjectId(id); } catch { return id; }
	});
	const docs = hasGlobalFilters
		? preloadedDocs.filter((doc) => pageIds.includes(String(doc._id)))
		: objectIds.length
		? await jobsCollection.find({ _id: { $in: objectIds } }, { projection: JOB_LIST_PROJECTION }).toArray()
		: [];
	const byId = new Map(docs.map((doc) => [String(doc._id), doc]));
	return {
		docs: pageIds
			.map((id) => {
				const doc = byId.get(String(id));
				if (!doc) return null;
				const row = mergeJobStatusRows(doc.status, profileId);
				return { ...doc, status: row ? [canonicalStatusRow(profileId, row)] : [] };
			})
			.filter(Boolean),
		total,
		page,
		limit,
		state,
	};
}

/** Fast New-tab numbered pagination from the Redis date index. */
export async function listMaterializedPostedPage(body = {}) {
	if (!jobsCollection || !body.applierName) return null;
	if (!(body.applied === false || body.applied === "false") || hasUnsupportedStatusPageFilters(body)) return null;
	const account = await resolveApplierContext(String(body.applierName).trim());
	if (!account?.id) return null;
	const profileId = String(account.id);
	const page = Math.max(1, Number.parseInt(body.page, 10) || 1);
	const limit = Math.max(1, Math.min(5000, Number.parseInt(body.limit, 10) || 10));
	const skip = body.skip !== undefined && body.skip !== null && body.skip !== ""
		? Math.max(0, Number.parseInt(body.skip, 10) || 0)
		: (page - 1) * limit;
	const excludedJobIds = new Set(await readMaterializedJobStatusIds(profileId, "any"));
	const entries = await readDateTailPage({
		offset: skip,
		limit,
		includeExternal: false,
		excludeExtensionV2: !account.isBeta,
		excludedJobIds,
		direction: String(body.sort || "").toLowerCase() === "postedat_asc" ? "asc" : "desc",
	});
	const ids = entries.map((entry) => String(entry.jobId));
	const payloads = await getJobRankingPoints(ids);
	const cards = new Map(payloads.flatMap((payload) => {
		const id = String(payload.jobId || "");
		return id && payload.card ? [[id, { ...payload.card, _id: id, aiSkills: payload.aiSkills || [] }]] : [];
	}));
	const missingIds = ids.filter((id) => !cards.has(id));
	if (missingIds.length) {
		const objectIds = missingIds.map((id) => new ObjectId(id));
		const fallbackDocs = await jobsCollection.find(
			{ _id: { $in: objectIds } },
			{ projection: JOB_LIST_PROJECTION },
		).toArray();
		for (const doc of fallbackDocs) cards.set(String(doc._id), doc);
	}
	const all = await jobsCollection.countDocuments(account.isBeta ? {} : excludeExtensionV2JobsFilter());
	return {
		docs: ids.map((id) => cards.get(id)).filter(Boolean).map((doc) => ({ ...doc, status: [] })),
		total: Math.max(0, all - excludedJobIds.size),
		page,
		limit,
		state: "posted",
	};
}

export function canUseMaterializedStatusPageForTier(tier) {
	return isBetaTier(tier);
}

export function buildStatusProjectionData({ profileId, jobId, job, statuses }) {
	const states = statesOf(statuses);
	const merged = mergeJobStatusRows(statuses, profileId);
	const statusRow = merged ? canonicalStatusRow(profileId, merged) : null;
	return {
		schemaVersion: STATUS_PROJECTION_SCHEMA_VERSION,
		profileId,
		jobId,
		state: states[0] || (statuses.length ? "other" : null),
		states,
		sourceCatalog: job.sourceCatalog || "market",
		extensionV2: isExtensionV2Job(job),
		postedAt: job.postedAt || null,
		contribution: statusContribution(statuses),
		statusRow,
		statusFingerprint: statusRow ? statusFingerprint(statusRow) : null,
		updatedAt: new Date(),
	};
}

const ADJUST_COUNTS_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
local fields = {'any','rawApplied','applied','scheduled','declined','bid-ready','bid-completed','other'}
if not raw then
  for index, field in ipairs(fields) do
    local delta = tonumber(ARGV[index] or 0)
    if delta ~= 0 then redis.call('HINCRBY', KEYS[2], field, delta) end
  end
  redis.call('EXPIRE', KEYS[2], tonumber(ARGV[9]))
  return 0
end
local value = cjson.decode(raw)
for index, field in ipairs(fields) do
  local current = tonumber(value[field] or 0)
  local delta = tonumber(ARGV[index] or 0)
  value[field] = math.max(0, current + delta)
end
redis.call('SETEX', KEYS[1], tonumber(ARGV[9]), cjson.encode(value))
return 1
`;

const INITIALIZE_COUNTS_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
local value = cjson.decode(ARGV[1])
local pending = redis.call('HGETALL', KEYS[2])
for index = 1, #pending, 2 do
  local field = pending[index]
  local delta = tonumber(pending[index + 1] or 0)
  value[field] = math.max(0, tonumber(value[field] or 0) + delta)
end
redis.call('SETEX', KEYS[1], tonumber(ARGV[2]), cjson.encode(value))
redis.call('DEL', KEYS[2])
return 1
`;

const UPDATE_STATUS_IDS_SCRIPT = `
local jobId = ARGV[1]
local currentState = ARGV[2]
local states = {'applied','scheduled','declined','bid-ready','bid-completed'}
for index, state in ipairs(states) do
  local addedKey = KEYS[(index - 1) * 2 + 1]
  local removedKey = KEYS[(index - 1) * 2 + 2]
  redis.call('SREM', addedKey, jobId)
  redis.call('SADD', removedKey, jobId)
  if state == currentState then
    redis.call('SREM', removedKey, jobId)
    redis.call('SADD', addedKey, jobId)
  end
end
return 1
`;

function countsFromStatusBaseline(profileId, baseline) {
	const idsByState = STATUS_STATES.map((state) => baseline[state] || []);
	return {
		profileId: String(profileId),
		any: new Set(idsByState.flat().map(String)).size,
		rawApplied: new Set([
			...(baseline.applied || []),
			...(baseline.scheduled || []),
			...(baseline.declined || []),
		].map(String)).size,
		applied: (baseline.applied || []).length,
		scheduled: (baseline.scheduled || []).length,
		declined: (baseline.declined || []).length,
		'bid-ready': (baseline['bid-ready'] || []).length,
		'bid-completed': (baseline['bid-completed'] || []).length,
		other: 0,
	};
}

function warmMaterializedJobStatusCounts(profileId, includeExtensionV2) {
	if (!isRedisReady()) return null;
	const warmupKey = `${profileId}:${includeExtensionV2 ? "all" : "public"}`;
	if (statusCountWarmups.has(warmupKey)) return statusCountWarmups.get(warmupKey);
	const warmup = (async () => {
		const baseline = await loadStatusIdBaseline(profileId);
		const counts = countsFromStatusBaseline(profileId, baseline);
		await getRedis().eval(INITIALIZE_COUNTS_SCRIPT, {
			keys: [
				statusCountsCacheKey(profileId, includeExtensionV2),
				statusCountsPendingKey(profileId, includeExtensionV2),
			],
			arguments: [JSON.stringify(counts), String(STATUS_COUNTS_CACHE_TTL_SEC)],
		});
		return counts;
	})().catch((error) => {
		console.warn('[jobs] status count warmup failed:', error?.message || error);
		return null;
	}).finally(() => statusCountWarmups.delete(warmupKey));
	statusCountWarmups.set(warmupKey, warmup);
	return warmup;
}

async function loadStatusIdBaseline(profileId) {
	const key = String(profileId);
	const cached = statusIdBaselineCache.get(key);
	if (cached) return cached;
	if (isRedisReady()) {
		const raw = await getRedis().get(statusBaselineCacheKey(key));
		if (raw) {
			try {
				const baseline = JSON.parse(raw);
				statusIdBaselineCache.set(key, baseline);
				return baseline;
			} catch { /* rebuild from Firestore */ }
		}
	}
	let baseline;
	if (enabled()) {
		const snapshot = await getFirestoreDb().collection("job_statuses")
			.where("profileId", "==", key)
			.select("jobId", "state", "postedAt", "schemaVersion", "statusRow", "statusFingerprint")
			.get();
		baseline = Object.fromEntries(STATUS_STATES.map((state) => [state, []]));
		const projectionRows = snapshot.docs.map((doc) => doc.data());
		// An empty result is not proof that this profile has no statuses: it can
		// also mean the projection collection has not been backfilled yet.
		const projectionsValid = projectionRows.length > 0 &&
			projectionRows.every((row) => projectedStatusRow(key, row));
		if (projectionsValid) {
			projectionRows.sort((left, right) =>
				(Date.parse(right.postedAt || 0) || 0) - (Date.parse(left.postedAt || 0) || 0),
			);
			for (const row of projectionRows) {
				if (STATUS_STATES.includes(row.state) && row.jobId) baseline[row.state].push(String(row.jobId));
			}
		} else {
			// A pre-v2 projection is never interpreted as business state. Rebuild
			// the in-memory baseline from the canonical embedded rows instead.
			const profileValues = [key];
			try { profileValues.unshift(new ObjectId(key)); } catch { /* string profile id */ }
			const docs = await jobsCollection.find(
				{ 'status.applier': { $in: profileValues } },
				{ projection: { status: 1, postedAt: 1 } },
			).sort({ postedAt: -1, _id: -1 }).toArray();
			for (const job of docs) {
				const state = resolveJobStatusState(job.status, key);
				if (STATUS_STATES.includes(state)) baseline[state].push(String(job._id));
			}
		}
	} else {
		const profileValues = [key];
		try { profileValues.unshift(new ObjectId(key)); } catch { /* string profile id */ }
		const docs = await jobsCollection.find(
			{ 'status.applier': { $in: profileValues } },
			{ projection: { status: 1, postedAt: 1 } },
		).sort({ postedAt: -1, _id: -1 }).toArray();
		baseline = Object.fromEntries(STATUS_STATES.map((state) => [state, []]));
		for (const job of docs) {
			const statuses = (Array.isArray(job.status) ? job.status : [])
				.filter((row) => String(row?.applier || '') === key);
			for (const state of statesOf(statuses)) baseline[state].push(String(job._id));
		}
	}
	statusIdBaselineCache.set(key, baseline);
	if (isRedisReady()) {
		await getRedis().setEx(statusBaselineCacheKey(key), STATUS_BASELINE_CACHE_TTL_SEC, JSON.stringify(baseline));
	}
	return baseline;
}

/** Ordered status IDs without requiring a Firestore composite index. */
export async function readMaterializedJobStatusIds(profileId, state) {
	if (!profileId || (state !== "any" && !STATUS_STATES.includes(state))) return [];
	const baseline = await loadStatusIdBaseline(profileId);
	if (state === "any") {
		if (!isRedisReady()) return [...new Set(STATUS_STATES.flatMap((item) => baseline[item] || []).map(String))];
		const stateLists = await Promise.all(STATUS_STATES.map((item) => readMaterializedJobStatusIds(profileId, item)));
		return [...new Set(stateLists.flat().map(String))];
	}
	if (!isRedisReady()) return [...(baseline[state] || [])];
	const [added, removed] = await Promise.all([
		getRedis().sMembers(statusAddedKey(profileId, state)),
		getRedis().sMembers(statusRemovedKey(profileId, state)),
	]);
	const removedIds = new Set(removed.map(String));
	const addedIds = added.map(String);
	const addedSet = new Set(addedIds);
	return [
		...addedIds,
		...(baseline[state] || []).filter((jobId) => !removedIds.has(String(jobId)) && !addedSet.has(String(jobId))),
	];
}

function countDeltas(previousStatuses, statuses) {
	const previous = statusContribution(previousStatuses);
	const next = statusContribution(statuses);
	const hadStatus = Array.isArray(previousStatuses) && previousStatuses.length > 0;
	const hasStatus = Array.isArray(statuses) && statuses.length > 0;
	return [
		Number(hasStatus) - Number(hadStatus),
		next.rawApplied - previous.rawApplied,
		next.applied - previous.applied,
		next.scheduled - previous.scheduled,
		next.declined - previous.declined,
		next["bid-ready"] - previous["bid-ready"],
		next["bid-completed"] - previous["bid-completed"],
		Number(hasStatus && !statesOf(statuses).length) - Number(hadStatus && !statesOf(previousStatuses).length),
	];
}

async function publishStatusCache(profileId, jobId, statuses, {
	previousStatuses = [],
	extensionV2 = false,
	adjustCounts = true,
} = {}) {
	invalidateLiveProjectedStatusCount(profileId);
	await bumpStatusRevision(profileId);
	if (!isRedisReady()) return;
	const merged = mergeJobStatusRows(statuses, profileId);
	const value = merged
		? JSON.stringify(canonicalStatusRow(profileId, merged))
		: STATUS_CACHE_EMPTY;
	const deltas = countDeltas(previousStatuses, statuses).map(String);
	const countKeys = adjustCounts ? [statusCountsCacheKey(profileId, true)] : [];
	if (adjustCounts && !extensionV2) countKeys.push(statusCountsCacheKey(profileId, false));
	const currentStates = new Set(statesOf(statuses));
	const statusIdWrite = adjustCounts
		? getRedis().eval(UPDATE_STATUS_IDS_SCRIPT, {
			keys: STATUS_STATES.flatMap((state) => [statusAddedKey(profileId, state), statusRemovedKey(profileId, state)]),
			arguments: [jobId, STATUS_STATES.find((state) => currentStates.has(state)) || ""],
		})
		: Promise.resolve(1);
	const adjustmentResults = await Promise.all([
		getRedis().setEx(statusCacheKey(profileId, jobId), STATUS_CACHE_TTL_SEC, value),
		statusIdWrite,
		...countKeys.map((key) => getRedis().eval(ADJUST_COUNTS_SCRIPT, {
			keys: [key, `${key}:pending`],
			arguments: [...deltas, String(STATUS_COUNTS_CACHE_TTL_SEC)],
		})),
	]);
	if (adjustCounts && adjustmentResults.slice(2).some((result) => Number(result) === 0)) {
		void warmMaterializedJobStatusCounts(profileId, true);
		if (!extensionV2) void warmMaterializedJobStatusCounts(profileId, false);
	}
}

/** Pure state-machine used by every Apply/Bid/Pipeline mutation. */
export function reduceJobStatuses(statusRows, profileValue, transition, now = new Date().toISOString()) {
	const profileId = String(profileValue || "");
	const otherRows = [];
	for (const row of Array.isArray(statusRows) ? statusRows : []) {
		if (String(row?.applier || "") !== profileId && row) otherRows.push(row);
	}
	let current = mergeJobStatusRows(statusRows, profileId);
	if (current) current = { ...current, applier: profileId };
	const previous = current ? { ...current } : null;
	const before = current ? JSON.stringify(current) : null;
	const ensure = () => { current ||= { applier: profileId }; };
	switch (transition) {
		case "apply":
			ensure();
			current.appliedDate ||= now;
			break;
		case "unapply":
			current = null;
			break;
		case "scheduled":
			ensure();
			current.appliedDate ||= now;
			current.scheduledDate = now;
			delete current.declinedDate;
			break;
		case "declined":
			ensure();
			current.appliedDate ||= now;
			current.declinedDate = now;
			delete current.scheduledDate;
			break;
		case "applied":
			ensure();
			current.appliedDate ||= now;
			delete current.scheduledDate;
			delete current.declinedDate;
			break;
		case "bid-ready":
			ensure();
			current.bidReadyDate ||= now;
			break;
		case "bid-completed":
			ensure();
			current.bidReadyDate ||= now;
			current.bidCompletedDate ||= now;
			break;
		case "clear-bid":
			if (current) {
				delete current.bidReadyDate;
				delete current.bidCompletedDate;
				if (!current.appliedDate && !current.scheduledDate && !current.declinedDate) current = null;
			}
			break;
		default:
			throw new Error(`Unsupported job status transition: ${transition}`);
	}
	const statuses = current ? [...otherRows, current] : otherRows;
	return { statuses, current, previous, changed: before !== (current ? JSON.stringify(current) : null) };
}

/**
 * Canonical status mutation. Firestore updates the job and its indexed
 * profile/job status document in one transaction; no catalog-wide counter
 * document is touched on the interactive request path.
 */
export async function mutateJobStatus({ jobId: jobIdRaw, applierName, transition }) {
	const jobId = String(jobIdRaw || "");
	const name = String(applierName || "").trim();
	if (!ObjectId.isValid(jobId)) throw new Error("Invalid job id");
	if (!name) throw new Error("applierName is required");
	const account = await resolveApplierContext(name);
	if (!account?.id) throw new Error(`User ${name} not found`);
	const profileId = String(account.id);
	const objectId = new ObjectId(jobId);

	if (!enabled()) {
		const job = await jobsCollection.findOne({ _id: objectId });
		if (!job || (!account.isBeta && isExtensionV2Job(job))) throw new Error("Job not found");
			const reduced = reduceJobStatuses(job.status, profileId, transition);
		await jobsCollection.updateOne({ _id: objectId }, {
			$set: { status: reduced.statuses },
			$unset: { statusProfileIds: "" },
		});
		await publishStatusCache(profileId, jobId, reduced.current ? [reduced.current] : [], {
			previousStatuses: reduced.previous ? [reduced.previous] : [],
			extensionV2: isExtensionV2Job(job),
		});
		return { job: { ...job, status: reduced.statuses }, changed: reduced.changed, profileId };
	}

	const firestore = getFirestoreDb();
	const jobRef = firestore.collection("jobs").doc(jobId);
	const statusRef = firestore.collection("job_statuses").doc(jobStatusProjectionId(profileId, jobId));
	const result = await firestore.runTransaction(async (transaction) => {
		const snapshot = await transaction.get(jobRef);
		if (
			!snapshot.exists ||
			snapshot.data()?.sourceCatalog !== "market" ||
			(!account.isBeta && isExtensionV2Job(snapshot.data()))
		) throw new Error("Job not found");
		const job = snapshot.data();
		const reduced = reduceJobStatuses(job.status, profileId, transition);
		transaction.update(jobRef, {
			status: reduced.statuses,
			statusProfileIds: FieldValue.delete(),
		});
		const profileStatuses = reduced.current ? [reduced.current] : [];
		if (profileStatuses.length) {
			transaction.set(statusRef, buildStatusProjectionData({ profileId, jobId, job, statuses: profileStatuses }), { merge: false });
		} else {
			transaction.delete(statusRef);
		}
		return {
			job: { ...job, _id: objectId, status: reduced.statuses },
			changed: reduced.changed,
			profileStatuses,
			previousStatuses: reduced.previous ? [reduced.previous] : [],
			extensionV2: isExtensionV2Job(job),
		};
	});
	// This write bypasses the Mongo-compatible adapter, so explicitly discard
	// cached job reads before any subsequent filtered/list query can observe the
	// old embedded status array.
	jobsCollection?._invalidateCaches?.();
	await publishStatusCache(profileId, jobId, result.profileStatuses, {
		previousStatuses: result.previousStatuses,
		extensionV2: result.extensionV2,
	});
	return { job: result.job, changed: result.changed, profileId };
}

export async function syncJobStatusProjection(jobIdRaw, profileIdRaw) {
	const jobId = String(jobIdRaw || "");
	const profileId = String(profileIdRaw || "");
	if (!jobId || !profileId) return false;
	if (!jobsCollection) return false;
	let objectId;
	try { objectId = new ObjectId(jobId); } catch { objectId = jobId; }
	const job = await jobsCollection.findOne(
		{ _id: objectId },
		{ projection: { status: 1, postedAt: 1, sourceCatalog: 1, version: 1, extensionV2: 1 } },
	);
	if (!job) return false;
	const statuses = (Array.isArray(job.status) ? job.status : [])
		.filter((row) => String(row?.applier || "") === profileId);
	if (!enabled()) {
		await publishStatusCache(profileId, jobId, statuses, {
			extensionV2: isExtensionV2Job(job),
			adjustCounts: false,
		});
		return true;
	}
	const statusRef = getFirestoreDb().collection("job_statuses").doc(jobStatusProjectionId(profileId, jobId));
	if (statuses.length) {
		await statusRef.set(buildStatusProjectionData({ profileId, jobId, job, statuses }), { merge: false });
		await jobsCollection.updateOne({ _id: objectId }, { $unset: { statusProfileIds: "" } });
	} else {
		await statusRef.delete();
		await jobsCollection.updateOne({ _id: objectId }, { $unset: { statusProfileIds: "" } });
	}
	await publishStatusCache(profileId, jobId, statuses, { adjustCounts: false });
	return true;
}

export async function readMaterializedJobStatusCounts(profileId, { includeExtensionV2 = true } = {}) {
	if (!profileId) return null;
	const cacheKey = statusCountsCacheKey(profileId, includeExtensionV2);
	if (isRedisReady()) {
		const cached = await getRedis().get(cacheKey);
		if (cached) {
			try { return JSON.parse(cached); } catch { /* reload */ }
		}
	}
	void warmMaterializedJobStatusCounts(profileId, includeExtensionV2);
	return null;
}

export async function readProjectedJobStatuses(profileId, jobIds = []) {
  if (!profileId || !jobIds.length) return new Map();
  const normalizedProfileId = String(profileId);
  const ids = [...new Set(jobIds.map(String))];
  const values = isRedisReady()
    ? await getRedis().mGet(ids.map((jobId) => statusCacheKey(normalizedProfileId, jobId)))
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
      const row = canonicalStatusRow(normalizedProfileId, JSON.parse(value));
      statuses.set(ids[index], [row]);
    } catch {
      missingIds.push(ids[index]);
    }
  });
  if (!missingIds.length) return statuses;

	const rowsById = new Map();
	let canonicalFallbackIds = [...missingIds];
	const firestore = enabled() ? getFirestoreDb() : null;
	if (firestore) {
		const snapshots = [];
		for (let start = 0; start < missingIds.length; start += 250) {
			const chunk = missingIds.slice(start, start + 250);
			const refs = chunk.map((jobId) => firestore.collection("job_statuses")
				.doc(jobStatusProjectionId(normalizedProfileId, jobId)));
			snapshots.push(...await firestore.getAll(...refs));
		}
		canonicalFallbackIds = [];
		for (let index = 0; index < missingIds.length; index += 1) {
			const jobId = missingIds[index];
			const snapshot = snapshots[index];
			const row = snapshot?.exists ? projectedStatusRow(normalizedProfileId, snapshot.data()) : null;
			if (row) rowsById.set(jobId, row);
			else canonicalFallbackIds.push(jobId);
		}
	}

	if (canonicalFallbackIds.length) {
		const objectIds = canonicalFallbackIds.map((jobId) => {
			try { return new ObjectId(jobId); } catch { return jobId; }
		});
		const docs = await jobsCollection.find(
			{ _id: { $in: objectIds } },
			{ projection: { status: 1, postedAt: 1, sourceCatalog: 1, version: 1, extensionV2: 1 } },
		).toArray();
		const docsById = new Map(docs.map((job) => [String(job._id), job]));
		const projectionWriter = firestore ? firestore.bulkWriter() : null;
		for (const jobId of canonicalFallbackIds) {
			const job = docsById.get(jobId);
			const merged = job ? mergeJobStatusRows(job.status, normalizedProfileId) : null;
			const row = merged ? canonicalStatusRow(normalizedProfileId, merged) : null;
			if (row) rowsById.set(jobId, row);
			if (projectionWriter) {
				const ref = firestore.collection("job_statuses").doc(jobStatusProjectionId(normalizedProfileId, jobId));
				if (row && job) {
					projectionWriter.set(ref, buildStatusProjectionData({
						profileId: normalizedProfileId,
						jobId,
						job,
						statuses: [row],
					}), { merge: false });
				} else {
					projectionWriter.delete(ref);
				}
			}
		}
		if (projectionWriter) await projectionWriter.close();
	}

	const cacheWrites = [];
	for (const jobId of missingIds) {
		const row = rowsById.get(jobId) || null;
    if (row) statuses.set(jobId, [row]);
    if (isRedisReady()) {
      cacheWrites.push(getRedis().setEx(
        statusCacheKey(normalizedProfileId, jobId),
        STATUS_CACHE_TTL_SEC,
        row ? JSON.stringify(row) : STATUS_CACHE_EMPTY,
      ));
    }
  }
	if (cacheWrites.length) await Promise.all(cacheWrites);
  return statuses;
}
