import test from "node:test";
import assert from "node:assert/strict";
import {
  canUseMaterializedStatusPageForTier,
  stateOf,
  statesOf,
  statusContribution,
} from "./jobStatusProjectionService.js";

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
    rawApplied: 1, applied: 1, scheduled: 1, declined: 0, "bid-ready": 0, "bid-completed": 0,
  });
	assert.deepEqual(statesOf(statuses), ["scheduled", "applied"]);
});

test("global materialized status pages are beta-only", () => {
	assert.equal(canUseMaterializedStatusPageForTier("beta"), true);
	assert.equal(canUseMaterializedStatusPageForTier("jobseeker"), false);
	assert.equal(canUseMaterializedStatusPageForTier(null), false);
});
