import test from "node:test";
import assert from "node:assert/strict";
import { DocumentId } from "@nextoffer/shared/document-id";
import { firestoreAdapterTest, firestoreUniqueReservations } from "./firestoreDataAdapter.js";

const {
	matches,
	applyUpdate,
	runPipeline,
	buildNativeQueryPlan,
	buildFallbackQueryPlan,
	queryPlanCoversAllClauses,
	collectFilterFields,
	canTryCompositeQuery,
	shouldTryCompositeQuery,
	shouldPreferFilterFirstOrdering,
	conjunctiveDocumentIds,
	resolveUpsertDocumentId,
} = firestoreAdapterTest;

test("Firestore compatibility query plan translates bounded indexed filters", () => {
	const plan = buildNativeQueryPlan({
		$and: [
			{ applierName: "Owner One" },
			{ createdAt: { $gte: new Date("2026-07-01T00:00:00Z") } },
			{ status: { $in: ["ready", "done"] } },
		],
	});
	assert.equal(plan.complete, true);
	assert.deepEqual(plan.clauses.map(({ field, operator }) => [field, operator]), [
		["applierName", "=="],
		["createdAt", ">="],
		["status", "in"],
	]);
});

test("Firestore compatibility query plan marks regex and OR filters as fallback scans", () => {
	const plan = buildNativeQueryPlan({ $or: [{ title: /react/i }, { company: "Example" }] });
	assert.equal(plan.complete, false);
	assert.deepEqual(plan.clauses, []);
});

test("Firestore compatibility bounds mixed local and native job-search filters to one indexed clause", () => {
	const plan = buildNativeQueryPlan({
		$and: [
			{ sourceCatalog: "market" },
			{ title: /PCB/i },
			{ source: { $in: ["Greenhouse"] } },
			{ postedAt: { $gte: "2026-07-19" } },
		],
	});
	assert.equal(plan.complete, false);
	assert.ok(plan.clauses.length > 1);
	const fallback = buildFallbackQueryPlan(plan, "job_market");
	assert.equal(fallback.clauses.length, 1);
	assert.equal(fallback.clauses[0].field, "source");
});

test("Firestore fallback never applies pagination before remaining local predicates", () => {
	const plan = buildNativeQueryPlan({
		ownerName: "Owner One",
		generateParentJobId: "job-1",
		source: "generated",
	});
	const fallback = buildFallbackQueryPlan(plan, "user_resumes");
	assert.equal(queryPlanCoversAllClauses(plan, fallback), false);
	assert.equal(queryPlanCoversAllClauses(plan, plan), true);
});

test("Firestore fallback bounds résumé reuse by job identity instead of broad status", () => {
	const plan = buildNativeQueryPlan({
		applierName: "Owner One",
		generate_parent_job_id: "job-1",
		status: "completed",
	});
	const fallback = buildFallbackQueryPlan(plan, "resume_generations");
	assert.equal(fallback.clauses[0].field, "generate_parent_job_id");
});

test("Firestore compatibility fallback keeps fields needed by nested local filters", () => {
	const fields = collectFilterFields({
		$and: [
			{ sourceCatalog: "market" },
			{ $or: [{ "titleReview.processingState": { $exists: false } }, { "titleReview.processingState": "failed" }] },
			{ status: { $not: { $elemMatch: { applier: "owner-1" } } } },
		],
	});
	assert.deepEqual([...fields].sort(), ["sourceCatalog", "status", "titleReview"]);
});

test("Firestore compatibility does not probe undeployed multi-field indexes by default", () => {
	assert.equal(canTryCompositeQuery({ clauses: [{ field: "source" }, { field: "sourceCatalog" }] }), false);
	assert.equal(canTryCompositeQuery({ clauses: [{ field: "sourceCatalog" }] }), true);
});

test("title-review queues use their composite index and filter-first fallback", () => {
	const plan = buildNativeQueryPlan({
		$and: [
			{ sourceCatalog: "market" },
			{ "titleReview.label": "REVIEW_REQUIRED" },
		],
	});
	assert.equal(shouldTryCompositeQuery(plan), true);
	const fallback = buildFallbackQueryPlan(plan, "job_market");
	assert.equal(fallback.clauses[0].field, "titleReview.label");
	assert.equal(shouldPreferFilterFirstOrdering(fallback), true);
	assert.equal(shouldPreferFilterFirstOrdering(fallback, ["titleReview.confidence", -1]), false);
});

test("Firestore compatibility extracts Algolia document IDs for authoritative point reloads", () => {
	const first = new DocumentId();
	const second = new DocumentId();
	assert.deepEqual(
		conjunctiveDocumentIds({ $and: [{ sourceCatalog: "market" }, { _id: { $in: [first, second] } }] }),
		[first.toHexString(), second.toHexString()],
	);
});

test("Firestore compatibility preserves explicit IDs for conditional upserts", () => {
	assert.equal(
		resolveUpsertDocumentId("job_identity_registry", {
			_id: "job_identity_backfill_v1",
			leaseUntil: { $lt: "2026-07-27T10:00:00.000Z" },
		}),
		"job_identity_backfill_v1",
	);
});

test("Firestore compatibility filter handles document IDs, arrays, regex, and elemMatch", () => {
	const id = new DocumentId();
	const doc = { _id: id, title: "Senior React Engineer", tags: ["React", "TypeScript"], status: [{ applier: id, appliedDate: "2026-07-23" }] };
	assert.equal(matches(doc, { _id: id, title: /react/i, tags: { $all: [/react/i, "TypeScript"] }, status: { $elemMatch: { applier: id, appliedDate: { $exists: true } } } }), true);
	assert.equal(matches(doc, { title: /python/i }), false);
});

test("Firestore compatibility update applies array filters atomically-shaped", () => {
	const a = new DocumentId();
	const b = new DocumentId();
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

test("unique reservations preserve conditional unique keys independently of document IDs", () => {
	const reservations = firestoreUniqueReservations("vendor_tasks", {
		applierName: "Owner One",
		jobId: "job-1",
		applyUrl: "https://example.test/apply/1",
	}, "legacy-object-id");
	assert.equal(reservations.length, 2);
	assert.equal(new Set(reservations.map((item) => item.id)).size, 2);
	assert.ok(reservations.every((item) => item.targetId === "legacy-object-id"));
});
