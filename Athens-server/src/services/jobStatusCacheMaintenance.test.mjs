import test from "node:test";
import assert from "node:assert/strict";
import {
	buildJobStatusCachePlan,
	inspectJobStatusCaches,
	replaceJobStatusCaches,
} from "./jobStatusCacheMaintenance.js";

function snapshotDoc(id, value) {
	return { id, data: () => value };
}

function queryFor(docs) {
	return {
		select() { return this; },
		async get() { return { docs, size: docs.length }; },
		async *stream() { yield* docs; },
	};
}

function fakeFirestore({ accounts, jobs, projections }) {
	return {
		collection(name) {
			if (name === "account_info") return queryFor(accounts);
			if (name === "jobs") return queryFor(jobs);
			if (name === "job_statuses") return queryFor(projections);
			throw new Error(`Unexpected collection ${name}`);
		},
	};
}

class FakeRedis {
	constructor(initial = {}) {
		this.values = new Map(Object.entries(initial));
	}

	async get(key) { return this.values.get(key) ?? null; }

	async del(keys) {
		let deleted = 0;
		for (const key of Array.isArray(keys) ? keys : [keys]) {
			if (this.values.delete(key)) deleted += 1;
		}
		return deleted;
	}

	async *scanIterator({ MATCH: match }) {
		const prefix = String(match || "").replace(/\*+$/, "");
		yield [...this.values.keys()].filter((key) => key.startsWith(prefix));
	}

	multi() {
		const operations = [];
		return {
			setEx: (key, _ttl, value) => { operations.push([key, value]); },
			exec: async () => {
				for (const [key, value] of operations) this.values.set(key, value);
				return operations.map(() => "OK");
			},
		};
	}
}

function fixture() {
	const accounts = [
		snapshotDoc("profile-1", { _id: "profile-1", name: "Alice" }),
		snapshotDoc("profile-2", { _id: "profile-2", name: "Bob" }),
	];
	const jobs = [
		snapshotDoc("job-1", {
			postedAt: "2026-01-03T00:00:00.000Z",
			status: [{ applier: "profile-1", appliedDate: "2026-01-03T00:00:00.000Z" }],
		}),
		snapshotDoc("job-2", {
			postedAt: "2026-01-02T00:00:00.000Z",
			status: [{
				applier: "profile-1",
				appliedDate: "2026-01-01T00:00:00.000Z",
				scheduledDate: "2026-01-02T00:00:00.000Z",
			}],
		}),
		snapshotDoc("job-3", {
			postedAt: "2026-01-01T00:00:00.000Z",
			status: [{ applier: "profile-2", bidReadyDate: "2026-01-01T00:00:00.000Z" }],
		}),
	];
	const projections = [
		snapshotDoc("projection-1", { profileId: "profile-1", jobId: "job-1", state: "applied" }),
		snapshotDoc("projection-2", { profileId: "profile-1", jobId: "job-2", state: "scheduled" }),
		snapshotDoc("projection-3", { profileId: "profile-2", jobId: "job-3", state: "bid-ready" }),
	];
	return { accounts, jobs, projections };
}

test("cache plan derives isolated active states from embedded job rows", async () => {
	const plan = await buildJobStatusCachePlan(fakeFirestore(fixture()));
	assert.equal(plan.issues.length, 0);
	assert.equal(plan.statusRows, 3);
	assert.deepEqual(plan.projectionComparison, { missing: 0, extra: 0, stateMismatches: 0 });
	const alice = plan.profiles.find((profile) => profile.name === "Alice");
	const bob = plan.profiles.find((profile) => profile.name === "Bob");
	assert.deepEqual(alice.baseline.applied, ["job-1"]);
	assert.deepEqual(alice.baseline.scheduled, ["job-2"]);
	assert.deepEqual(bob.baseline["bid-ready"], ["job-3"]);
});

test("all-profile repair replaces stale values and preserves unrelated Redis data", async () => {
	const plan = await buildJobStatusCachePlan(fakeFirestore(fixture()));
	const redis = new FakeRedis({
		"ranking:v5:job-status-ids:firestore:profile-1:baseline": JSON.stringify({
			applied: [], scheduled: [], declined: [], "bid-ready": [], "bid-completed": [],
		}),
		"unrelated:key": "keep",
	});
	assert.equal((await inspectJobStatusCaches(redis, plan)).staleProfiles, 2);
	const result = await replaceJobStatusCaches(redis, plan);
	assert.equal(result.verifiedProfiles, 2);
	assert.equal((await inspectJobStatusCaches(redis, plan)).staleProfiles, 0);
	assert.equal(redis.values.get("unrelated:key"), "keep");
});

test("repair fails instead of reporting success when Redis writes fail", async () => {
	const plan = await buildJobStatusCachePlan(fakeFirestore(fixture()));
	const redis = new FakeRedis();
	redis.multi = () => ({
		setEx() {},
		async exec() { throw new Error("Redis write failed"); },
	});
	await assert.rejects(() => replaceJobStatusCaches(redis, plan), /Redis write failed/);
});
