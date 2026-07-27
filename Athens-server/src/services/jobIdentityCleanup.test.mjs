import assert from "node:assert/strict";
import test from "node:test";
import { cleanupExistingJobIdentityDuplicates } from "./jobIdentityCleanup.js";

function matches(doc, filter) {
	if (!doc || String(doc._id) !== String(filter._id)) return false;
	for (const [key, condition] of Object.entries(filter)) {
		if (key === "_id") continue;
		if (condition && typeof condition === "object" && "$lt" in condition) {
			if (!(doc[key] < condition.$lt)) return false;
		} else if (doc[key] !== condition) {
			return false;
		}
	}
	return true;
}

function memoryRegistry() {
	const docs = new Map();
	return {
		docs,
		async findOne(filter) {
			const doc = docs.get(String(filter._id));
			return doc ? { ...doc } : null;
		},
		async updateOne(filter, update, options = {}) {
			const id = String(filter._id);
			const current = docs.get(id);
			if (current && matches(current, filter)) {
				const next = { ...current, ...(update.$set || {}) };
				for (const key of Object.keys(update.$unset || {})) delete next[key];
				docs.set(id, next);
				return { modifiedCount: 1 };
			}
			if (!current && options.upsert) {
				docs.set(id, { _id: id, ...(update.$setOnInsert || {}), ...(update.$set || {}) });
				return { upsertedCount: 1, upsertedId: id };
			}
			if (current && options.upsert) {
				const error = new Error("duplicate");
				error.code = 11000;
				throw error;
			}
			return { modifiedCount: 0 };
		},
	};
}

test("one-time cleanup removes nine existing duplicates and keeps the latest", async () => {
	const jobs = Array.from({ length: 10 }, (_, index) => ({
		_id: `job-${index}`,
		title: index % 2 ? " software   engineer " : "Software Engineer",
		company: { name: index % 2 ? "ATHENS" : "Athens" },
		_createdAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
	}));
	const registry = memoryRegistry();
	const cleaned = {
		scores: [],
		ranking: [],
		skills: [],
		embeddings: [],
		invalidations: 0,
	};
	const marketCollection = {
		find() {
			return {
				async *[Symbol.asyncIterator]() {
					for (const job of [...jobs]) yield job;
				},
			};
		},
		async deleteMany(filter) {
			const ids = new Set(filter._id.$in.map(String));
			let deletedCount = 0;
			for (let index = jobs.length - 1; index >= 0; index -= 1) {
				if (!ids.has(String(jobs[index]._id))) continue;
				jobs.splice(index, 1);
				deletedCount += 1;
			}
			return { deletedCount };
		},
	};

	const result = await cleanupExistingJobIdentityDuplicates({
		marketCollection,
		registryCollection: registry,
		deleteScores: async (ids) => cleaned.scores.push(...ids.map(String)),
		removeRanking: async (ids) => cleaned.ranking.push(...ids.map(String)),
		removeSkillIndex: async (id) => cleaned.skills.push(String(id)),
		removeEmbedding: async (id) => cleaned.embeddings.push(String(id)),
		invalidateStatusCounts: () => { cleaned.invalidations += 1; },
	});

	assert.deepEqual(result, { scanned: 10, kept: 1, removed: 9 });
	assert.deepEqual(jobs.map((job) => job._id), ["job-9"]);
	for (const values of [cleaned.scores, cleaned.ranking, cleaned.skills, cleaned.embeddings]) {
		assert.equal(values.length, 9);
		assert.equal(values.includes("job-9"), false);
	}
	assert.equal(cleaned.invalidations, 1);

	const second = await cleanupExistingJobIdentityDuplicates({
		marketCollection,
		registryCollection: registry,
	});
	assert.equal(second.alreadyComplete, true);
	assert.equal(second.removed, 9);
});
