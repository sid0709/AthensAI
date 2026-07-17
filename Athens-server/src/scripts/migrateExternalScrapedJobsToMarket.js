/**
 * Migrate external_scraped_jobs into job_market and fix source from jobLink.
 *
 * Also runs automatically on server start (see src/db/mongo.js). This CLI is for
 * manual / dry-run runs.
 *
 * Usage: node src/scripts/migrateExternalScrapedJobsToMarket.js [--dry-run]
 */
import dotenv from "dotenv";
dotenv.config();

import { initMongo, closeMongo } from "../db/mongo.js";
import { migrateAllExternalScrapedJobsToMarket } from "../services/promoteExternalJobToMarket.js";

const dryRun = process.argv.includes("--dry-run");

async function main() {
	await initMongo();
	await migrateAllExternalScrapedJobsToMarket({ dryRun });
	await closeMongo();
}

main().catch(async (err) => {
	console.error("[migrate-external→market] fatal:", err);
	await closeMongo().catch(() => {});
	process.exit(1);
});
