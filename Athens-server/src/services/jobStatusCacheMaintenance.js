import { resolveJobStatusState } from "@nextoffer/shared/job-status";
import { createProfileIdResolver, normalizeCanonicalJobStatuses } from "./canonicalJobStatus.js";
import { isExtensionV2Job } from "../config/jobMarketSchema.js";
import {
	JOB_STATUS_STATES,
	buildJobStatusCountsCache,
	clearJobStatusCaches,
	emptyJobStatusBaseline,
	jobStatusBaselineCacheKey,
	jobStatusCacheKey,
	jobStatusCountsCacheKey,
	jobStatusBaselineCount,
	parseJobStatusBaseline,
	parseJobStatusCountsCache,
	serializeJobStatusBaseline,
} from "./jobStatusCache.js";

const STATUS_CACHE_TTL_SEC = 60 * 60;
const STATUS_DERIVED_CACHE_TTL_SEC = 7 * 24 * 60 * 60;
const WRITE_BATCH_SIZE = 500;

function dateMillis(value) {
	if (value instanceof Date) return value.getTime();
	if (value && typeof value?.toDate === "function") return value.toDate().getTime();
	const parsed = Date.parse(String(value || ""));
	return Number.isFinite(parsed) ? parsed : 0;
}

function sameBaseline(left, right) {
	return JOB_STATUS_STATES.every((state) =>
		JSON.stringify(left?.[state] || []) === JSON.stringify(right?.[state] || []),
	);
}

function baselineFromEntries(entries, { publicOnly = false } = {}) {
	const baseline = emptyJobStatusBaseline();
	for (const entry of entries) {
		if (publicOnly && entry.extensionV2) continue;
		baseline[entry.state].push(entry.jobId);
	}
	return baseline;
}

/** Build a complete Redis repair plan from authoritative embedded job.status rows. */
export async function buildJobStatusCachePlan(firestore) {
	const accountSnapshot = await firestore.collection("account_info").get();
	const accounts = accountSnapshot.docs.map((document) => ({
		...document.data(),
		_id: String(document.data()?._id || document.id),
	}));
	const resolveProfileId = createProfileIdResolver(accounts);
	const profilesById = new Map(accounts.map((account) => [String(account._id), {
		id: String(account._id),
		name: String(account.name || account._id),
		entries: [],
	}]));
	const issues = [];
	let jobsScanned = 0;

	const jobStream = firestore.collection("jobs")
		.select("status", "postedAt", "createdAt", "sourceCatalog", "version", "extensionV2")
		.stream();
	for await (const document of jobStream) {
		const job = document.data();
		const normalized = normalizeCanonicalJobStatuses(job.status, resolveProfileId);
		for (const issue of normalized.issues) issues.push({ jobId: document.id, ...issue });
		for (const statusRow of normalized.statuses) {
			const state = resolveJobStatusState(statusRow);
			if (!JOB_STATUS_STATES.includes(state)) continue;
			const profile = profilesById.get(String(statusRow.applier));
			if (!profile) {
				issues.push({
					jobId: document.id,
					field: "applier",
					value: String(statusRow.applier),
					reason: "status row references an account missing from account_info",
				});
				continue;
			}
			profile.entries.push({
				jobId: String(document.id),
				state,
				statusRow,
				postedAt: job.postedAt || job.createdAt || null,
				extensionV2: isExtensionV2Job(job),
			});
		}
		jobsScanned += 1;
	}

	const expectedProjections = new Map();
	const profiles = [...profilesById.values()]
		.sort((left, right) => left.name.localeCompare(right.name))
		.map((profile) => {
			profile.entries.sort((left, right) =>
				dateMillis(right.postedAt) - dateMillis(left.postedAt) ||
				right.jobId.localeCompare(left.jobId),
			);
			for (const entry of profile.entries) {
				expectedProjections.set(`${profile.id}\0${entry.jobId}`, entry.state);
			}
			const baseline = baselineFromEntries(profile.entries);
			const publicBaseline = baselineFromEntries(profile.entries, { publicOnly: true });
			return { ...profile, baseline, publicBaseline };
		});

	const actualProjections = new Map();
	const projectionStream = firestore.collection("job_statuses")
		.select("profileId", "jobId", "state")
		.stream();
	for await (const document of projectionStream) {
		const projection = document.data();
		const profileId = String(projection.profileId || "");
		const jobId = String(projection.jobId || "");
		if (profileId && jobId) actualProjections.set(`${profileId}\0${jobId}`, String(projection.state || ""));
	}

	let missingProjections = 0;
	let extraProjections = 0;
	let mismatchedProjectionStates = 0;
	for (const [key, state] of expectedProjections) {
		if (!actualProjections.has(key)) missingProjections += 1;
		else if (actualProjections.get(key) !== state) mismatchedProjectionStates += 1;
	}
	for (const key of actualProjections.keys()) {
		if (!expectedProjections.has(key)) extraProjections += 1;
	}

	return {
		profiles,
		issues,
		jobsScanned,
		statusRows: expectedProjections.size,
		projectionRows: actualProjections.size,
		projectionComparison: {
			missing: missingProjections,
			extra: extraProjections,
			stateMismatches: mismatchedProjectionStates,
		},
	};
}

export async function inspectJobStatusCaches(redis, plan) {
	const profiles = [];
	for (const profile of plan.profiles) {
		const [baselineRaw, countsRaw] = await Promise.all([
			redis.get(jobStatusBaselineCacheKey(profile.id)),
			redis.get(jobStatusCountsCacheKey(profile.id, true)),
		]);
		const baseline = parseJobStatusBaseline(baselineRaw, profile.id);
		const counts = parseJobStatusCountsCache(countsRaw, profile.id);
		const expectedCounts = buildJobStatusCountsCache(profile.id, profile.baseline);
		const countsMatch = Boolean(counts) && [
			"any", "rawApplied", "applied", "scheduled", "declined",
			"bid-ready", "bid-completed", "other",
		].every((field) => counts[field] === expectedCounts[field]);
		profiles.push({
			profileId: profile.id,
			name: profile.name,
			expected: jobStatusBaselineCount(profile.baseline),
			cached: baseline ? jobStatusBaselineCount(baseline) : null,
			baselineMatch: Boolean(baseline) && sameBaseline(baseline, profile.baseline),
			countsMatch,
		});
	}
	return {
		profiles,
		staleProfiles: profiles.filter((profile) => !profile.baselineMatch || !profile.countsMatch).length,
	};
}

async function flushPipeline(state) {
	if (!state.pending) return;
	await state.pipeline.exec();
	state.pipeline = state.redis.multi();
	state.pending = 0;
}

async function queueSetEx(state, key, ttl, value) {
	state.pipeline.setEx(key, ttl, value);
	state.pending += 1;
	state.written += 1;
	if (state.pending >= WRITE_BATCH_SIZE) await flushPipeline(state);
}

/** Replace every derived job-status Redis value and verify all profile baselines/counts. */
export async function replaceJobStatusCaches(redis, plan) {
	if (plan.issues.length) {
		throw new Error(`Refusing cache repair: ${plan.issues.length} canonical status issue(s) found`);
	}
	const cleared = await clearJobStatusCaches(redis);
	const state = { redis, pipeline: redis.multi(), pending: 0, written: 0 };
	for (const profile of plan.profiles) {
		await queueSetEx(
			state,
			jobStatusBaselineCacheKey(profile.id),
			STATUS_DERIVED_CACHE_TTL_SEC,
			serializeJobStatusBaseline(profile.id, profile.baseline),
		);
		await queueSetEx(
			state,
			jobStatusCountsCacheKey(profile.id, true),
			STATUS_DERIVED_CACHE_TTL_SEC,
			JSON.stringify(buildJobStatusCountsCache(profile.id, profile.baseline)),
		);
		await queueSetEx(
			state,
			jobStatusCountsCacheKey(profile.id, false),
			STATUS_DERIVED_CACHE_TTL_SEC,
			JSON.stringify(buildJobStatusCountsCache(profile.id, profile.publicBaseline)),
		);
		for (const entry of profile.entries) {
			await queueSetEx(
				state,
				jobStatusCacheKey(profile.id, entry.jobId),
				STATUS_CACHE_TTL_SEC,
				JSON.stringify(entry.statusRow),
			);
		}
	}
	await flushPipeline(state);

	const verification = await inspectJobStatusCaches(redis, plan);
	if (verification.staleProfiles > 0) {
		throw new Error(`Job status cache verification failed for ${verification.staleProfiles} profile(s)`);
	}
	return { cleared, written: state.written, verifiedProfiles: plan.profiles.length };
}
