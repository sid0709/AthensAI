import test from "node:test";
import assert from "node:assert/strict";
import {
  buildStatusProjectionData,
  canUseMaterializedStatusPageForTier,
  canonicalJobCatalog,
  canonicalProjectedStatusIds,
  authoritativeJobStatusBaseline,
  normalizeMaterializedJobStatusCounts,
	normalizeBulkStatusJobs,
	reduceJobStatuses,
  stateOf,
  statesOf,
  statusContribution,
} from "./jobStatusProjectionService.js";

test("bulk status jobs are validated, deduplicated, and keep catalog identity", () => {
	assert.deepEqual(normalizeBulkStatusJobs([
		{ id: "507f1f77bcf86cd799439011", catalog: "market" },
		{ id: "507f1f77bcf86cd799439011", catalog: "external" },
		{ id: "not-an-id", catalog: "market" },
		{ id: "507f191e810c19729de860ea", catalog: "EXTERNAL" },
	]), [
		{ jobId: "507f1f77bcf86cd799439011", catalog: "market" },
		{ jobId: "507f191e810c19729de860ea", catalog: "external" },
	]);
});

test("Mongo-era jobs without sourceCatalog remain market jobs", () => {
	assert.equal(canonicalJobCatalog(undefined), "market");
	assert.equal(canonicalJobCatalog(""), "market");
	assert.equal(canonicalJobCatalog(" EXTERNAL "), "external");
});

test("status projection gives completed and scheduled states precedence", () => {
  assert.equal(stateOf({ appliedDate: "a", scheduledDate: "s" }), "scheduled");
  assert.equal(stateOf({ bidReadyDate: "r", bidCompletedDate: "b" }), "bid-completed");
});

test("materialized counters preserve product tab semantics", () => {
  assert.deepEqual(statusContribution({ appliedDate: "a" }), {
    rawApplied: 1, applied: 1, scheduled: 0, declined: 0, "bid-ready": 0, "bid-completed": 0,
  });
  assert.deepEqual(statusContribution({ bidReadyDate: "r", bidCompletedDate: "b" }), {
    rawApplied: 0, applied: 0, scheduled: 0, declined: 0, "bid-ready": 0, "bid-completed": 1,
  });
});

test("duplicate status rows count each tab once per job and profile", () => {
  const statuses = [
    { appliedDate: "a1" },
    { appliedDate: "a2" },
    { scheduledDate: "s" },
  ];
  assert.deepEqual(statusContribution(statuses), {
		rawApplied: 1, applied: 0, scheduled: 1, declined: 0, "bid-ready": 0, "bid-completed": 0,
  });
	assert.deepEqual(statesOf(statuses), ["scheduled"]);
});

test("global materialized status pages are beta-only", () => {
	assert.equal(canUseMaterializedStatusPageForTier("beta"), true);
	assert.equal(canUseMaterializedStatusPageForTier("jobseeker"), false);
	assert.equal(canUseMaterializedStatusPageForTier(null), false);
});

test("status counts are rebased onto the current live catalog", () => {
	assert.deepEqual(normalizeMaterializedJobStatusCounts({
		all: 15_835,
		posted: 15_330,
		any: 505,
		applied: 505,
		scheduled: 0,
		declined: 0,
		"bid-ready": 0,
		"bid-completed": 0,
	}, 14_925, 505), {
		all: 14_925,
		posted: 14_420,
		"bid-ready": 0,
		"bid-completed": 0,
		applied: 505,
		scheduled: 0,
		declined: 0,
	});
});

test("no status tab can exceed All even when a projection is stale", () => {
	const counts = normalizeMaterializedJobStatusCounts({
		all: 20_000,
		posted: 19_000,
		any: 1_000,
		applied: 2_000,
	}, 25, 10);
	assert.equal(counts.all, 25);
	assert.equal(counts.posted, 15);
	assert.equal(counts.applied, 10);
	assert.ok(Object.values(counts).every((count) => count <= counts.all));
});

test("the canonical status reducer preserves bid history while applying", () => {
	const reduced = reduceJobStatuses(
		[{ applier: "profile-1", bidReadyDate: "ready" }],
		"profile-1",
		"apply",
		"now",
	);
	assert.equal(reduced.current.appliedDate, "now");
	assert.equal(reduced.current.bidReadyDate, "ready");
	assert.equal(reduced.previous.bidReadyDate, "ready");
});

test("clear-bid keeps pipeline state but removes a bid-only row", () => {
	const applied = reduceJobStatuses(
		[{ applier: "profile-1", appliedDate: "applied", bidReadyDate: "ready" }],
		"profile-1",
		"clear-bid",
	);
	assert.equal(applied.current.appliedDate, "applied");
	assert.equal(applied.current.bidReadyDate, undefined);

	const bidOnly = reduceJobStatuses(
		[{ applier: "profile-1", bidReadyDate: "ready" }],
		"profile-1",
		"clear-bid",
	);
	assert.equal(bidOnly.current, null);
	assert.deepEqual(bidOnly.statuses, []);
});

test("mutating one profile never changes another profile's status row", () => {
	const other = { applier: "profile-2", scheduledDate: "2026-01-02T00:00:00.000Z" };
	const reduced = reduceJobStatuses([
		{ applier: "profile-1", appliedDate: "2026-01-01T00:00:00.000Z" },
		other,
	], "profile-1", "unapply");
	assert.deepEqual(reduced.statuses, [other]);
	assert.equal(reduced.current, null);
});

test("the canonical reducer implements every pipeline and bid transition", () => {
	let statuses = [];
	let result = reduceJobStatuses(statuses, "profile-1", "bid-ready", "2026-01-01T00:00:00.000Z");
	assert.equal(stateOf(result.current), "bid-ready");
	statuses = result.statuses;
	result = reduceJobStatuses(statuses, "profile-1", "bid-completed", "2026-01-02T00:00:00.000Z");
	assert.equal(stateOf(result.current), "bid-completed");
	statuses = result.statuses;
	result = reduceJobStatuses(statuses, "profile-1", "apply", "2026-01-03T00:00:00.000Z");
	assert.equal(stateOf(result.current), "applied");
	statuses = result.statuses;
	result = reduceJobStatuses(statuses, "profile-1", "scheduled", "2026-01-04T00:00:00.000Z");
	assert.equal(stateOf(result.current), "scheduled");
	assert.equal(result.current.appliedDate, "2026-01-03T00:00:00.000Z");
	statuses = result.statuses;
	result = reduceJobStatuses(statuses, "profile-1", "declined", "2026-01-05T00:00:00.000Z");
	assert.equal(stateOf(result.current), "declined");
	assert.equal(result.current.scheduledDate, undefined);
	statuses = result.statuses;
	result = reduceJobStatuses(statuses, "profile-1", "applied", "2026-01-06T00:00:00.000Z");
	assert.equal(stateOf(result.current), "applied");
	assert.equal(result.current.declinedDate, undefined);
	result = reduceJobStatuses(result.statuses, "profile-1", "unapply");
	assert.equal(result.current, null);
	assert.deepEqual(result.statuses, []);
});

test("projection v2 stores the exact canonical row and its fingerprint", () => {
	const projection = buildStatusProjectionData({
		profileId: "profile-1",
		jobId: "job-1",
		job: { sourceCatalog: "market", postedAt: "2026-01-04T00:00:00.000Z" },
		statuses: [{
			applier: "profile-1",
			appliedDate: "2026-01-01T00:00:00.000Z",
			scheduledDate: "2026-01-03T00:00:00.000Z",
		}],
	});
	assert.equal(projection.schemaVersion, 2);
	assert.equal(projection.state, "scheduled");
	assert.deepEqual(projection.statusRow, {
		applier: "profile-1",
		appliedDate: "2026-01-01T00:00:00.000Z",
		scheduledDate: "2026-01-03T00:00:00.000Z",
	});
	assert.match(projection.statusFingerprint, /^[a-f0-9]{64}$/);
});

test("canonical projection reads ignore legacy and tampered rows without discarding valid Bid Ready rows", () => {
	const valid = buildStatusProjectionData({
		profileId: "profile-1",
		jobId: "ready-job",
		job: { sourceCatalog: "market", postedAt: "2026-07-21T00:00:00.000Z" },
		statuses: [{ applier: "profile-1", bidReadyDate: "2026-07-21T00:00:00.000Z" }],
	});
	const legacy = {
		profileId: "profile-1",
		jobId: "legacy-job",
		state: "bid-ready",
		statusRow: { applier: "profile-1", bidReadyDate: "2026-07-20T00:00:00.000Z" },
	};
	const tampered = { ...valid, jobId: "tampered-job", statusFingerprint: "invalid" };

	assert.deepEqual(
		canonicalProjectedStatusIds("profile-1", "bid-ready", [legacy, tampered, valid]),
		["ready-job"],
	);
});

test("mixed status baselines keep verified rows and recover legacy rows only from canonical jobs", () => {
	const verified = buildStatusProjectionData({
		profileId: "profile-1",
		jobId: "verified-job",
		job: { postedAt: "2026-07-30T00:00:00.000Z" },
		statuses: [{ applier: "profile-1", appliedDate: "2026-07-30T00:00:00.000Z" }],
	});
	const legacy = {
		profileId: "profile-1",
		jobId: "legacy-job",
		state: "declined",
		postedAt: "2026-07-29T00:00:00.000Z",
	};
	const stale = { ...legacy, jobId: "deleted-job" };
	const canonicalJobs = new Map([[
		"legacy-job",
		{
			postedAt: "2026-07-29T00:00:00.000Z",
			status: [{
				applier: "profile-1",
				appliedDate: "2026-07-28T00:00:00.000Z",
				scheduledDate: "2026-07-29T00:00:00.000Z",
			}],
		},
	]]);

	assert.deepEqual(
		authoritativeJobStatusBaseline("profile-1", [legacy, stale, verified], canonicalJobs),
		{
			applied: ["verified-job"],
			scheduled: ["legacy-job"],
			declined: [],
			"bid-ready": [],
			"bid-completed": [],
		},
	);
});
