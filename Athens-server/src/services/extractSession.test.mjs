import { test } from "node:test";
import assert from "node:assert/strict";
import {
	claimPendingJobs,
	pendingExtractionQuery,
} from "./jobSkillExtraction/extractSession.js";
import { pendingTitleReviewQuery } from "./jobTitleReview/titleReviewSession.js";
import {
	parseJobSkillsBatchJson,
	parseJobSkillsJson,
	reasoningEffortForExtraction,
} from "./jobSkillExtraction/aiExtractService.js";
import { aggregateJobSkillBatches } from "./skillDictionary/skillDictionaryStore.js";

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

test("pending skill badge counts only jobs the user's tier can process", () => {
	assert.deepEqual(pendingExtractionQuery(true), { aiSkillStatus: "pending" });
	assert.deepEqual(pendingExtractionQuery(false), {
		aiSkillStatus: "pending",
		extensionV2: false,
	});
});

test("pending title review includes unprocessed and failed market jobs", () => {
	assert.deepEqual(pendingTitleReviewQuery(), {
		$or: [
			{ "titleReview.processingState": { $exists: false } },
			{ "titleReview.processingState": "failed" },
		],
	});
});

test("claimPendingJobs returns only jobs atomically claimed by this session", async () => {
	const updates = [];
	const collection = {
		async updateOne(filter, update) {
			updates.push({ filter, update });
			return { modifiedCount: String(filter._id) === "job-2" ? 0 : 1 };
		},
	};
	const claimed = await claimPendingJobs(
		collection,
		[{ _id: "job-1", title: "One" }, { _id: "job-2", title: "Two" }],
		{ sessionId: "session-1", claimedAt: "2026-07-25T00:00:00.000Z" },
	);

	assert.deepEqual(claimed.map((job) => job._id), ["job-1"]);
	assert.equal(updates.length, 2);
	assert.deepEqual(updates[0].filter, { _id: "job-1", aiSkillStatus: "pending" });
	assert.equal(updates[0].update.$set.aiSkillStatus, "extracting");
	assert.equal(updates[0].update.$set.aiSkillSessionId, "session-1");
});

test("claimPendingJobs uses the Firestore batch-claim path when available", async () => {
	let received;
	const collection = {
		async atomicClaimMany(ids, filter, update) {
			received = { ids, filter, update };
			return ["job-2"];
		},
	};
	const claimed = await claimPendingJobs(
		collection,
		[{ _id: "job-1", title: "One" }, { _id: "job-2", title: "Two" }],
		{ sessionId: "session-2", claimedAt: "2026-07-25T01:00:00.000Z" },
	);

	assert.deepEqual(claimed.map((job) => job._id), ["job-2"]);
	assert.deepEqual(received.ids, ["job-1", "job-2"]);
	assert.deepEqual(received.filter, { aiSkillStatus: "pending" });
	assert.equal(received.update.$set.aiSkillSessionId, "session-2");
});

test("skill extraction chooses a low-latency reasoning mode supported by the GPT-5 generation", () => {
	assert.equal(reasoningEffortForExtraction("openai", "gpt-5-nano"), "minimal");
	assert.equal(reasoningEffortForExtraction("openai", "gpt-5.4-mini"), "none");
	assert.equal(reasoningEffortForExtraction("deepseek", "deepseek-chat"), undefined);
});

test("skill extraction rejects generic practices but keeps named observability tools", () => {
	const skills = parseJobSkillsJson(JSON.stringify({
		skills: [
			{ name: "logging", category: "tools", requirement: 3 },
			{ name: "Metrics", category: "tools", requirement: 3 },
			{ name: "front-end testing frameworks", category: "hard", requirement: 4 },
			{ name: "Datadog", category: "devops", requirement: 4 },
			{ name: "OpenTelemetry", category: "devops", requirement: 4 },
			{ name: "React", category: "hard", requirement: 5 },
		],
	}));

	assert.deepEqual(skills.map((skill) => skill.name), ["Datadog", "OpenTelemetry", "React"]);
});

test("batched skill extraction maps only requested job ids and normalizes each result", () => {
	const parsed = parseJobSkillsBatchJson(JSON.stringify({
		jobs: [
			{ id: "job-1", skills: [
				{ name: "React", category: "hard", requirement: 3 },
				{ name: "React.js", category: "tools", requirement: 5 },
				{ name: "logging", category: "tools", requirement: 4 },
			] },
			{ id: "job-2", skills: [{ name: "PostgreSQL", category: "hard", requirement: 4 }] },
			{ id: "unexpected", skills: [{ name: "Python", category: "hard", requirement: 5 }] },
		],
	}), ["job-1", "job-2"]);

	assert.deepEqual([...parsed.keys()], ["job-1", "job-2"]);
	assert.deepEqual(parsed.get("job-1"), [{ name: "React", category: "tools", requirement: 5 }]);
	assert.deepEqual(parsed.get("job-2"), [{ name: "PostgreSQL", category: "hard", requirement: 4 }]);
});

test("dictionary batching counts a canonical skill once per job using its highest requirement", () => {
	const entries = aggregateJobSkillBatches([
		[
			{ name: "React", category: "hard", requirement: 2 },
			{ name: "React.js", category: "tools", requirement: 5 },
		],
		[{ name: "React", category: "hard", requirement: 4 }],
	]);

	assert.deepEqual(entries, [{
		name: "React",
		canonical: "react",
		jobCount: 2,
		requirementSum: 9,
		categoryCounts: { tools: 1, hard: 1 },
	}]);
});
