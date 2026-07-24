#!/usr/bin/env node
import "dotenv/config";
import { initMongo, closeMongo } from "../db/mongo.js";
import { runJobAnalysisBatch } from "../services/jobAnalysis/index.js";
import { runMatchScoreBatch } from "../services/matching/matchScoreWorker.js";
import { rebuildAlgoliaJobs } from "../services/search/algoliaJobs.js";

const kind = String(process.env.CLOUD_JOB_KIND || process.argv[2] || "").trim();
const maxRounds = Math.max(1, Number(process.env.CLOUD_JOB_MAX_ROUNDS || 10_000));

async function drain(worker) {
	let rounds = 0;
	let processed = 0;
	while (rounds < maxRounds) {
		const result = await worker();
		rounds += 1;
		const count = typeof result.processed === "number" ? result.processed : result.processed ? 1 : 0;
		processed += count;
		if (!count) break;
	}
	return { rounds, processed, exhausted: rounds >= maxRounds };
}

try {
	await initMongo();
	let result;
	if (kind === "search-rebuild") result = await rebuildAlgoliaJobs();
	else if (kind === "job-analysis-backfill") {
		if (String(process.env.FIRESTORE_WRITES_ENABLED).toLowerCase() !== "true") throw new Error("FIRESTORE_WRITES_ENABLED=true is required for this backfill");
		result = await drain(() => runJobAnalysisBatch(50));
	} else if (kind === "match-score-backfill") {
		if (String(process.env.FIRESTORE_WRITES_ENABLED).toLowerCase() !== "true") throw new Error("FIRESTORE_WRITES_ENABLED=true is required for this backfill");
		result = await drain(runMatchScoreBatch);
	}
	else throw new Error("CLOUD_JOB_KIND must be search-rebuild, job-analysis-backfill, or match-score-backfill");
	console.log(JSON.stringify({ ok: true, kind, ...result }));
} finally {
	await closeMongo();
}
