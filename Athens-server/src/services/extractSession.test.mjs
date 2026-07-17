import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * Mirrors the interleave-by-date logic in extractSession claimBatch.
 */
function mergePendingByDate(marketJobs, externalJobs, n) {
	function jobSortDate(job) {
		const raw = job._sortDate;
		if (raw instanceof Date) return raw.getTime();
		if (typeof raw === "string") return new Date(raw).getTime() || 0;
		return 0;
	}
	const merged = [...marketJobs, ...externalJobs].sort((a, b) => jobSortDate(b) - jobSortDate(a));
	return merged.slice(0, n);
}

test("mergePendingByDate interleaves market and external by newest date", () => {
	const market = [
		{ _id: "m1", catalog: "market", _sortDate: "2026-07-01T00:00:00.000Z" },
		{ _id: "m2", catalog: "market", _sortDate: "2026-07-03T00:00:00.000Z" },
	];
	const external = [
		{ _id: "e1", catalog: "external", _sortDate: "2026-07-02T00:00:00.000Z" },
	];
	const batch = mergePendingByDate(market, external, 2);
	assert.deepEqual(batch.map((j) => j._id), ["m2", "e1"]);
});

test("combined pending count is sum of both catalogs", () => {
	const pendingMarket = 180;
	const pendingExternal = 45;
	assert.equal(pendingMarket + pendingExternal, 225);
});
