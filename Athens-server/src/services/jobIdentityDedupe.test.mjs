import assert from "node:assert/strict";
import test from "node:test";
import {
	backfillJobIdentityRegistry,
	buildJobIdentity,
	claimJobIdentity,
	finalizeJobIdentityClaim,
	normalizeJobIdentityText,
	selectExistingJobIdentityDuplicates,
} from "./jobIdentityDedupe.js";

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

function applyUpdate(doc, update, inserting = false) {
	const next = { ...doc };
	if (inserting) Object.assign(next, update.$setOnInsert || {});
	Object.assign(next, update.$set || {});
	for (const [key, value] of Object.entries(update.$max || {})) {
		if (next[key] == null || value > next[key]) next[key] = value;
	}
	for (const key of Object.keys(update.$unset || {})) delete next[key];
	return next;
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
				docs.set(id, applyUpdate(current, update));
				return { modifiedCount: 1 };
			}
			if (!current && options.upsert) {
				docs.set(id, applyUpdate({ _id: id }, update, true));
				return { modifiedCount: 0, upsertedCount: 1, upsertedId: id };
			}
			if (current && options.upsert) {
				const error = new Error("duplicate");
				error.code = 11000;
				throw error;
			}
			return { modifiedCount: 0 };
		},
		async deleteOne(filter) {
			const id = String(filter._id);
			const current = docs.get(id);
			if (!matches(current, filter)) return { deletedCount: 0 };
			docs.delete(id);
			return { deletedCount: 1 };
		},
		async bulkWrite(operations) {
			for (const operation of operations) {
				const spec = operation.updateOne;
				await this.updateOne(spec.filter, spec.update, spec);
			}
			return { acknowledged: true };
		},
	};
}

test("normalizes identity text across Unicode, casing, and whitespace", () => {
	assert.equal(normalizeJobIdentityText("  ＡCME\t Labs  "), "acme labs");
	assert.deepEqual(
		buildJobIdentity("Acme Labs", "Senior Engineer"),
		buildJobIdentity(" acme   labs ", "SENIOR engineer"),
	);
});

test("company/title claim is global and inclusive through exactly 30 days", async () => {
	const registry = memoryRegistry();
	const firstAt = new Date("2026-01-01T00:00:00.000Z");
	const first = await claimJobIdentity(registry, {
		companyName: "Acme",
		title: "Engineer",
		acceptedAt: firstAt,
		source: "extension",
	});
	assert.equal(first.claimed, true);
	await finalizeJobIdentityClaim(registry, first, { jobId: "job-1" });

	const boundary = await claimJobIdentity(registry, {
		companyName: " ACME ",
		title: "engineer",
		acceptedAt: new Date(firstAt.getTime() + 30 * 24 * 60 * 60 * 1000),
		source: "exposed-api",
	});
	assert.equal(boundary.duplicate, true);
	assert.equal(boundary.existingJobId, "job-1");

	const afterBoundary = await claimJobIdentity(registry, {
		companyName: "Acme",
		title: "Engineer",
		acceptedAt: new Date(firstAt.getTime() + 30 * 24 * 60 * 60 * 1000 + 1),
		source: "extension-v2",
	});
	assert.equal(afterBoundary.claimed, true);
});

test("simultaneous identical submissions produce one atomic claim", async () => {
	const registry = memoryRegistry();
	const attempts = await Promise.all(
		Array.from({ length: 8 }, () => claimJobIdentity(registry, {
			companyName: "Athens",
			title: "Software Engineer",
			acceptedAt: new Date("2026-07-27T12:00:00.000Z"),
		})),
	);
	assert.equal(attempts.filter((attempt) => attempt.claimed).length, 1);
	assert.equal(attempts.filter((attempt) => attempt.duplicate).length, 7);
});

test("an abandoned pending claim can be recovered after its lease expires", async () => {
	const registry = memoryRegistry();
	const first = await claimJobIdentity(registry, {
		companyName: "Athens",
		title: "Platform Engineer",
	});
	assert.equal(first.claimed, true);
	registry.docs.get(first.identity.key).claimExpiresAt = new Date(0).toISOString();

	const recovered = await claimJobIdentity(registry, {
		companyName: "ATHENS",
		title: "platform engineer",
	});
	assert.equal(recovered.claimed, true);
	assert.notEqual(recovered.claimToken, first.claimToken);
});

test("historical backfill keeps the newest acceptance for a normalized identity", async () => {
	const registry = memoryRegistry();
	const jobs = [
		{
			_id: "old",
			title: "Senior Engineer",
			company: { name: "Acme Labs" },
			_createdAt: "2026-01-01T00:00:00.000Z",
		},
		{
			_id: "new",
			title: " senior   engineer ",
			company: { name: "ACME LABS" },
			createdAt: "2026-02-01T00:00:00.000Z",
		},
	];
	const jobsCollection = {
		find() {
			return {
				async *[Symbol.asyncIterator]() {
					for (const job of jobs) yield job;
				},
			};
		},
	};

	const result = await backfillJobIdentityRegistry(jobsCollection, registry);
	assert.deepEqual(result, { scanned: 2, identities: 1 });
	const identity = buildJobIdentity("Acme Labs", "Senior Engineer");
	assert.equal(registry.docs.get(identity.key).acceptedAt, "2026-02-01T00:00:00.000Z");
	assert.equal(registry.docs.get("job_identity_backfill_v1").status, "complete");
});

test("historical cleanup selection keeps only the latest normalized identity", () => {
	const jobs = [
		{ _id: "old", title: "Engineer", company: { name: "Acme" }, _createdAt: "2025-01-01T00:00:00Z" },
		{ _id: "middle", title: " engineer ", company: { name: "ACME" }, _createdAt: "2026-01-01T00:00:00Z" },
		{ _id: "latest", title: "ENGINEER", company: { name: " Acme " }, _createdAt: "2026-07-01T00:00:00Z" },
		{ _id: "other", title: "Designer", company: { name: "Acme" }, _createdAt: "2024-01-01T00:00:00Z" },
	];
	const result = selectExistingJobIdentityDuplicates(jobs);
	assert.deepEqual(result.keepers.map((job) => job._id), ["latest"]);
	assert.deepEqual(result.duplicates.map((job) => job._id), ["middle", "old"]);
});
