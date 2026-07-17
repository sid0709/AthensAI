/**
 * Remove scraper-only fields from all job_market documents and bump
 * modelVersion from 1.12.8 to 2026.07.07.
 *
 * Usage: node src/scripts/cleanupJobMarketFields.js
 */
import dotenv from 'dotenv';
dotenv.config();

import { initMongo, closeMongo, jobsCollection } from '../db/mongo.js';
import {
	JOB_MARKET_MODEL_VERSION,
	SCRAPER_ONLY_JOB_FIELDS,
	scraperOnlyJobFieldsUnset,
} from '../config/jobMarketSchema.js';

const BATCH = 500;

async function main() {
	await initMongo();
	if (!jobsCollection) throw new Error('MongoDB not ready');

	const unset = scraperOnlyJobFieldsUnset();
	const hasScraperField = SCRAPER_ONLY_JOB_FIELDS.map((field) => ({ [field]: { $exists: true } }));
	const filter = {
		$or: [
			...hasScraperField,
			{ modelVersion: '1.12.8' },
			{ modelVersion: { $exists: false } },
		],
	};

	const total = await jobsCollection.countDocuments(filter);
	console.log(`[cleanup-job-market] ${total} job(s) to update`);

	let updated = 0;
	let ops = [];
	const flush = async () => {
		if (!ops.length) return;
		await jobsCollection.bulkWrite(ops, { ordered: false });
		updated += ops.length;
		console.log(`  … ${updated}/${total} updated`);
		ops = [];
	};

	const cursor = jobsCollection.find(filter, { projection: { _id: 1 } });
	for await (const doc of cursor) {
		ops.push({
			updateOne: {
				filter: { _id: doc._id },
				update: {
					$unset: unset,
					$set: { modelVersion: JOB_MARKET_MODEL_VERSION },
				},
			},
		});
		if (ops.length >= BATCH) await flush();
	}
	await flush();

	console.log('[cleanup-job-market] done:', { updated, modelVersion: JOB_MARKET_MODEL_VERSION });
	await closeMongo?.();
	process.exit(0);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
