#!/usr/bin/env node
import "dotenv/config";
import { closeRedis, getRedis, initRedis, isRedisReady } from "../db/redis.js";
import { getFirestoreDb } from "../services/firebase/firebaseAdmin.js";
import {
	buildJobStatusCachePlan,
	inspectJobStatusCaches,
	replaceJobStatusCaches,
} from "../services/jobStatusCacheMaintenance.js";

const APPLY = process.argv.includes("--apply");

function profileSummary(profile) {
	return {
		name: profile.name,
		expected: profile.expected,
		cached: profile.cached,
		baselineMatch: profile.baselineMatch,
		countsMatch: profile.countsMatch,
	};
}

async function main() {
	const firestore = getFirestoreDb();
	const plan = await buildJobStatusCachePlan(firestore);
	console.log("[job-status-cache] canonical", {
		jobsScanned: plan.jobsScanned,
		statusRows: plan.statusRows,
		profiles: plan.profiles.length,
		issues: plan.issues.length,
		projectionRows: plan.projectionRows,
		projectionComparison: plan.projectionComparison,
	});
	if (plan.issues.length) {
		console.error(JSON.stringify(plan.issues.slice(0, 100)));
		throw new Error("Canonical status validation failed; Redis was not changed");
	}

	const connected = await initRedis({ force: true });
	if (!connected || !isRedisReady()) {
		throw new Error("Redis is required to inspect or repair job status caches");
	}
	const redis = getRedis();
	const inspection = await inspectJobStatusCaches(redis, plan);
	console.log("[job-status-cache] inspection", {
		staleProfiles: inspection.staleProfiles,
		profiles: inspection.profiles.map(profileSummary),
	});

	if (!APPLY) {
		console.log("[job-status-cache] dry run complete; rerun with --apply to replace derived Redis values");
		return;
	}

	const result = await replaceJobStatusCaches(redis, plan);
	console.log("[job-status-cache] repair complete", result);
}

main()
	.catch((error) => {
		console.error(error);
		process.exitCode = 1;
	})
	.finally(async () => {
		try { await closeRedis(); } catch { /* best effort */ }
	});
