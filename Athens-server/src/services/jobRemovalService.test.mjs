import test from "node:test";
import assert from "node:assert/strict";
import {
	deleteJobDocuments,
	findOtherCompanyJobIds,
	normalizeCompanySiblingRemoval,
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

test("normalizeCompanySiblingRemoval requires a company and safe active job id", () => {
	assert.deepEqual(normalizeCompanySiblingRemoval({ companyId: "cmp_acme", keepJobId: "job-2" }), {
		companyId: "cmp_acme",
		keepJobId: "job-2",
	});
	assert.equal(normalizeCompanySiblingRemoval({ companyId: "cmp_acme", keepJobId: "jobs/job-2" }), null);
});

test("findOtherCompanyJobIds keeps the active role and returns every sibling", async () => {
	const jobsCollection = {
		find(query) {
			assert.deepEqual(query, { companyId: "cmp_acme" });
			return {
				async toArray() {
					return [{ _id: "job-1" }, { _id: "job-2" }, { _id: "job-3" }];
				},
			};
		},
	};

	const result = await findOtherCompanyJobIds({
		companyId: "cmp_acme",
		keepJobId: "job-2",
		jobsCollection,
	});
	assert.deepEqual(result, ["job-1", "job-3"]);
});

test("findOtherCompanyJobIds rejects a stale company and active-job pairing", async () => {
	const jobsCollection = {
		find() {
			return { async toArray() { return [{ _id: "job-1" }]; } };
		},
	};

	await assert.rejects(
		findOtherCompanyJobIds({ companyId: "cmp_acme", keepJobId: "job-2", jobsCollection }),
		(error) => error.code === "COMPANY_GROUP_CHANGED",
	);
});
