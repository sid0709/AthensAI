/**
 * Backfill aiSkillStatus / matchScoreStatus on external_scraped_jobs documents
 * that predate the AI analysis pipeline.
 *
 * Marks duplicates (jobLink already extracted in job_market) as skipped_duplicate.
 *
 * Usage: node src/scripts/backfillExternalJobAnalysisFields.js [--dry-run]
 */
import dotenv from "dotenv";
dotenv.config();

import {
	initMongo,
	closeMongo,
	jobsCollection,
	externalScrapedJobsCollection,
} from "../db/mongo.js";
import { JOB_MARKET_MODEL_VERSION } from "../config/jobMarketSchema.js";

const dryRun = process.argv.includes("--dry-run");

async function main() {
	await initMongo();

	if (!externalScrapedJobsCollection || !jobsCollection) {
		throw new Error("MongoDB not ready");
	}

	const missing = await externalScrapedJobsCollection
		.find({ aiSkillStatus: { $exists: false } })
		.project({ _id: 1, jobLink: 1 })
		.toArray();

	console.log(`[backfill-external-analysis] ${missing.length} doc(s) missing aiSkillStatus, dryRun=${dryRun}`);

	let pending = 0;
	let skipped = 0;

	for (const doc of missing) {
		const jobLink = String(doc.jobLink || "").trim();
		let aiSkillStatus = "pending";
		let matchScoreStatus = "pending";

		if (jobLink) {
			const dup = await jobsCollection.findOne(
				{ applyLink: jobLink, aiSkillStatus: "extracted" },
				{ projection: { _id: 1 } },
			);
			if (dup) {
				aiSkillStatus = "skipped_duplicate";
				matchScoreStatus = "scored";
				skipped += 1;
			} else {
				pending += 1;
			}
		} else {
			pending += 1;
		}

		if (!dryRun) {
			await externalScrapedJobsCollection.updateOne(
				{ _id: doc._id },
				{
					$set: {
						catalog: "external",
						modelVersion: JOB_MARKET_MODEL_VERSION,
						aiSkillStatus,
						matchScoreStatus,
					},
				},
			);
		}
	}

	console.log(
		`[backfill-external-analysis] done — pending=${pending}, skipped_duplicate=${skipped}` +
			(dryRun ? " (dry run, no writes)" : ""),
	);

	await closeMongo();
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
