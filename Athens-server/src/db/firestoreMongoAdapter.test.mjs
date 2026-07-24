import test from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";
import { firestoreAdapterTest, firestoreUniqueReservations } from "./firestoreMongoAdapter.js";

const { matches, applyUpdate, runPipeline } = firestoreAdapterTest;

test("Firestore compatibility filter handles ObjectIds, arrays, regex, and elemMatch", () => {
	const id = new ObjectId();
	const doc = { _id: id, title: "Senior React Engineer", tags: ["React", "TypeScript"], status: [{ applier: id, appliedDate: "2026-07-23" }] };
	assert.equal(matches(doc, { _id: id, title: /react/i, tags: { $all: [/react/i, "TypeScript"] }, status: { $elemMatch: { applier: id, appliedDate: { $exists: true } } } }), true);
	assert.equal(matches(doc, { title: /python/i }), false);
});

test("Firestore compatibility update applies array filters atomically-shaped", () => {
	const a = new ObjectId();
	const b = new ObjectId();
	const doc = { status: [{ applier: a, state: "ready" }, { applier: b, state: "ready" }] };
	const next = applyUpdate(doc, { $set: { "status.$[elem].state": "done" } }, false, [{ "elem.applier": a }]);
	assert.deepEqual(next.status.map((item) => item.state), ["done", "ready"]);
});

test("Firestore compatibility aggregation supports reporting groups and facets", async () => {
	const docs = [
		{ source: "LinkedIn", cost: 2, createdAt: "2026-07-23T10:00:00Z" },
		{ source: "LinkedIn", cost: 3, createdAt: "2026-07-23T11:00:00Z" },
		{ source: "Indeed", cost: 4, createdAt: "2026-07-24T10:00:00Z" },
	];
	const result = await runPipeline(docs, [{ $facet: {
		bySource: [{ $group: { _id: "$source", count: { $sum: 1 }, cost: { $sum: "$cost" } } }, { $sort: { _id: 1 } }],
		total: [{ $count: "count" }],
	} }], { collection: () => { throw new Error("not used"); } });
	assert.deepEqual(result[0].total, [{ count: 3 }]);
	assert.deepEqual(result[0].bySource, [{ _id: "Indeed", count: 1, cost: 4 }, { _id: "LinkedIn", count: 2, cost: 5 }]);
});

test("unique reservations preserve Mongo partial unique keys independently of document IDs", () => {
	const reservations = firestoreUniqueReservations("vendor_tasks", {
		applierName: "Owner One",
		jobId: "job-1",
		applyUrl: "https://example.test/apply/1",
	}, "legacy-object-id");
	assert.equal(reservations.length, 2);
	assert.equal(new Set(reservations.map((item) => item.id)).size, 2);
	assert.ok(reservations.every((item) => item.targetId === "legacy-object-id"));
});
