import test from "node:test";
import assert from "node:assert/strict";
import {
	deleteJobDocuments,
	normalizeJobRemovalIds,
} from "./jobRemovalService.js";

test("normalizeJobRemovalIds deduplicates and validates exact document ids", () => {
	assert.deepEqual(normalizeJobRemovalIds({ ids: ["job-1", "job-1", "", "nested/job", "job-2"] }), ["job-1", "job-2"]);
});

test("normalizeJobRemovalIds accepts the catalog-aware compatibility payload", () => {
	assert.deepEqual(normalizeJobRemovalIds({ jobs: [{ id: "job-1", catalog: "external" }] }), ["job-1"]);
});

test("deleteJobDocuments performs one direct collection deletion", async () => {
	let calledWith;
	const jobsCollection = {
		async deleteDocumentsByIds(ids) {
			calledWith = ids;
			return { deletedCount: ids.length };
		},
	};

	const result = await deleteJobDocuments({
		ids: ["job-1", "job-2"],
		jobsCollection,
	});

	assert.deepEqual(calledWith, ["job-1", "job-2"]);
	assert.deepEqual(result, { deletedCount: 2 });
});
