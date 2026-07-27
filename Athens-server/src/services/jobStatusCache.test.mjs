import test from "node:test";
import assert from "node:assert/strict";
import {
	buildJobStatusCountsCache,
	emptyJobStatusBaseline,
	parseJobStatusBaseline,
	parseJobStatusCountsCache,
	serializeJobStatusBaseline,
} from "./jobStatusCache.js";

test("legacy unversioned empty status caches are rejected", () => {
	const legacyBaseline = JSON.stringify({
		applied: [], scheduled: [], declined: [], "bid-ready": [], "bid-completed": [],
	});
	const legacyCounts = JSON.stringify({ any: 0, applied: 0, scheduled: 0 });
	assert.equal(parseJobStatusBaseline(legacyBaseline, "profile-1"), null);
	assert.equal(parseJobStatusCountsCache(legacyCounts, "profile-1"), null);
});

test("a versioned empty baseline remains a valid zero-history profile", () => {
	const baseline = emptyJobStatusBaseline();
	const encoded = serializeJobStatusBaseline("profile-1", baseline);
	assert.deepEqual(parseJobStatusBaseline(encoded, "profile-1"), baseline);
	const counts = buildJobStatusCountsCache("profile-1", baseline);
	assert.deepEqual(parseJobStatusCountsCache(JSON.stringify(counts), "profile-1"), counts);
});

test("baseline cache identity and source count are validated", () => {
	const baseline = { ...emptyJobStatusBaseline(), applied: ["job-1"] };
	const encoded = JSON.parse(serializeJobStatusBaseline("profile-1", baseline));
	assert.equal(parseJobStatusBaseline(encoded, "profile-2"), null);
	assert.equal(parseJobStatusBaseline({ ...encoded, sourceCount: 0 }, "profile-1"), null);
});

test("status count caches preserve one active state per job", () => {
	const baseline = {
		applied: ["a"],
		scheduled: ["s"],
		declined: ["d"],
		"bid-ready": ["r"],
		"bid-completed": ["b"],
	};
	assert.deepEqual(buildJobStatusCountsCache("profile-1", baseline), {
		schemaVersion: 1,
		profileId: "profile-1",
		any: 5,
		rawApplied: 3,
		applied: 1,
		scheduled: 1,
		declined: 1,
		"bid-ready": 1,
		"bid-completed": 1,
		other: 0,
	});
});
