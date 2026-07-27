export const JOB_STATUS_CACHE_SCHEMA_VERSION = 1;

export const JOB_STATUS_STATES = Object.freeze([
	"applied",
	"scheduled",
	"declined",
	"bid-ready",
	"bid-completed",
]);

const CACHE_PREFIX = "ranking:v5:job-status";

function backendNamespace() {
	return String(process.env.DATABASE_BACKEND || "mongo").trim().toLowerCase() === "firestore"
		? "firestore"
		: "mongo";
}

function nonNegativeInteger(value) {
	const number = Number(value);
	return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

function normalizedIds(value) {
	if (!Array.isArray(value)) return null;
	return [...new Set(value.map(String).filter(Boolean))];
}

export function emptyJobStatusBaseline() {
	return Object.fromEntries(JOB_STATUS_STATES.map((state) => [state, []]));
}

export function normalizeJobStatusBaseline(value) {
	if (!value || typeof value !== "object") return null;
	const baseline = emptyJobStatusBaseline();
	for (const state of JOB_STATUS_STATES) {
		const ids = normalizedIds(value[state]);
		if (!ids) return null;
		baseline[state] = ids;
	}
	return baseline;
}

export function jobStatusBaselineCount(baseline) {
	return new Set(JOB_STATUS_STATES.flatMap((state) => baseline?.[state] || []).map(String)).size;
}

export function serializeJobStatusBaseline(profileId, baseline) {
	const normalized = normalizeJobStatusBaseline(baseline);
	if (!normalized) throw new Error("Invalid job status baseline");
	return JSON.stringify({
		schemaVersion: JOB_STATUS_CACHE_SCHEMA_VERSION,
		profileId: String(profileId),
		sourceCount: jobStatusBaselineCount(normalized),
		states: normalized,
	});
}

export function parseJobStatusBaseline(raw, profileId) {
	if (!raw) return null;
	try {
		const payload = typeof raw === "string" ? JSON.parse(raw) : raw;
		if (Number(payload?.schemaVersion) !== JOB_STATUS_CACHE_SCHEMA_VERSION) return null;
		if (String(payload?.profileId || "") !== String(profileId)) return null;
		const baseline = normalizeJobStatusBaseline(payload?.states);
		if (!baseline || nonNegativeInteger(payload?.sourceCount) !== jobStatusBaselineCount(baseline)) return null;
		return baseline;
	} catch {
		return null;
	}
}

export function buildJobStatusCountsCache(profileId, baseline) {
	const normalized = normalizeJobStatusBaseline(baseline);
	if (!normalized) throw new Error("Invalid job status baseline");
	return {
		schemaVersion: JOB_STATUS_CACHE_SCHEMA_VERSION,
		profileId: String(profileId),
		any: jobStatusBaselineCount(normalized),
		rawApplied: new Set([
			...normalized.applied,
			...normalized.scheduled,
			...normalized.declined,
		].map(String)).size,
		applied: normalized.applied.length,
		scheduled: normalized.scheduled.length,
		declined: normalized.declined.length,
		"bid-ready": normalized["bid-ready"].length,
		"bid-completed": normalized["bid-completed"].length,
		other: 0,
	};
}

export function parseJobStatusCountsCache(raw, profileId) {
	if (!raw) return null;
	try {
		const payload = typeof raw === "string" ? JSON.parse(raw) : raw;
		if (Number(payload?.schemaVersion) !== JOB_STATUS_CACHE_SCHEMA_VERSION) return null;
		if (String(payload?.profileId || "") !== String(profileId)) return null;
		const counts = { ...payload };
		for (const field of [
			"any",
			"rawApplied",
			"applied",
			"scheduled",
			"declined",
			"bid-ready",
			"bid-completed",
			"other",
		]) {
			if (!Number.isFinite(Number(payload[field])) || Number(payload[field]) < 0) return null;
			counts[field] = nonNegativeInteger(payload[field]);
		}
		return counts;
	} catch {
		return null;
	}
}

export function jobStatusCacheKey(profileId, jobId) {
	return `${CACHE_PREFIX}:${backendNamespace()}:${String(profileId)}:${String(jobId)}`;
}

export function jobStatusCountsCacheKey(profileId, includeExtensionV2 = true) {
	return `${CACHE_PREFIX}-counts:${backendNamespace()}:${String(profileId)}:${includeExtensionV2 ? "all" : "public"}`;
}

export function jobStatusCountsPendingKey(profileId, includeExtensionV2 = true) {
	return `${jobStatusCountsCacheKey(profileId, includeExtensionV2)}:pending`;
}

export function jobStatusAddedKey(profileId, state) {
	return `${CACHE_PREFIX}-ids:${backendNamespace()}:${String(profileId)}:${state}:added`;
}

export function jobStatusRemovedKey(profileId, state) {
	return `${CACHE_PREFIX}-ids:${backendNamespace()}:${String(profileId)}:${state}:removed`;
}

export function jobStatusBaselineCacheKey(profileId) {
	return `${CACHE_PREFIX}-ids:${backendNamespace()}:${String(profileId)}:baseline`;
}

export async function listJobStatusCacheKeys(redis) {
	const keys = new Set();
	for await (const result of redis.scanIterator({ MATCH: `${CACHE_PREFIX}*`, COUNT: 500 })) {
		for (const key of Array.isArray(result) ? result : [result]) {
			if (key) keys.add(String(key));
		}
	}
	return [...keys];
}

export async function clearJobStatusCaches(redis) {
	const keys = await listJobStatusCacheKeys(redis);
	let deleted = 0;
	for (let start = 0; start < keys.length; start += 500) {
		deleted += Number(await redis.del(keys.slice(start, start + 500))) || 0;
	}
	return { matched: keys.length, deleted };
}
