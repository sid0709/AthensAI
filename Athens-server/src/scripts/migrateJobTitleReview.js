/** Permanently remove legacy title-role fields and invalidate old search payloads. */
import dotenv from 'dotenv';
dotenv.config();
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { closeDataStore, initDataStore, jobsCollection } from '../db/dataStore.js';
import { closeRedis, initRedis } from '../db/redis.js';
import { JOB_MARKET_MODEL_VERSION } from '../config/jobMarketSchema.js';
import { bumpCatalogRevision, indexJobRankingBatch } from '../services/matching/jobRankingIndex.js';
import {
	initJobRankingCollection,
	removeJobRankingPayloadField,
} from '../services/vectorStore/qdrantClient.js';
import { rebuildAlgoliaJobs } from '../services/search/algoliaJobs.js';

const BATCH_SIZE = 200;
const LEGACY_FIELDS = ['titleScanned', 'titleScannedAt', 'titleScanStatus', 'titleScanError'];

export function legacyTitleReviewCleanupFilter() {
	return {
		$or: [
			...LEGACY_FIELDS.map((field) => ({ [field]: { $exists: true } })),
			{ modelVersion: { $ne: JOB_MARKET_MODEL_VERSION } },
		],
	};
}

export function legacyTitleReviewCleanupUpdate() {
	return {
		$unset: Object.fromEntries(LEGACY_FIELDS.map((field) => [field, ''])),
		$set: { modelVersion: JOB_MARKET_MODEL_VERSION },
	};
}

export async function cleanupLegacyTitleReviewFields(collection, {
	dryRun = false,
	batchSize = BATCH_SIZE,
	onProgress = () => undefined,
} = {}) {
	const filter = legacyTitleReviewCleanupFilter();
	let total = 0;
	if (typeof collection.findPaged === 'function') {
		for await (const _job of collection.findPaged(filter, { projection: { _id: 1 }, pageSize: batchSize })) total += 1;
	} else {
		total = await collection.countDocuments(filter);
	}
	if (dryRun) return { total, updated: 0, dryRun: true };
	let updated = 0;
	let operations = [];
	const flush = async () => {
		if (!operations.length) return;
		const result = await collection.bulkWrite(operations, { ordered: false });
		updated += result.modifiedCount || 0;
		operations = [];
		onProgress({ total, updated });
	};
	const cursor = typeof collection.findPaged === 'function'
		? collection.findPaged(filter, { projection: { _id: 1 }, pageSize: batchSize })
		: collection.find(filter, { projection: { _id: 1 } });
	for await (const job of cursor) {
		operations.push({
			updateOne: {
				filter: { _id: job._id },
				update: legacyTitleReviewCleanupUpdate(),
			},
		});
		if (operations.length >= batchSize) await flush();
	}
	await flush();
	return { total, updated, dryRun: false };
}

export async function rebuildTitleReviewRankingPayloads(collection, {
	batchSize = BATCH_SIZE,
	indexBatch = indexJobRankingBatch,
	onProgress = () => undefined,
} = {}) {
	let indexed = 0;
	let batch = [];
	const flush = async () => {
		if (!batch.length) return;
		const result = await indexBatch(batch, { catalog: 'market', wait: true });
		indexed += result?.indexed || 0;
		batch = [];
		onProgress({ indexed });
	};
	const cursor = typeof collection.findPaged === 'function'
		? collection.findPaged({}, { pageSize: batchSize })
		: collection.find({});
	for await (const job of cursor) {
		batch.push(job);
		if (batch.length >= batchSize) await flush();
	}
	await flush();
	return { indexed };
}

async function main() {
	const dryRun = process.argv.includes('--dry-run');
	await initDataStore();
	if (!jobsCollection) throw new Error('Firestore not ready');
	try {
		const cleanup = await cleanupLegacyTitleReviewFields(jobsCollection, {
			dryRun,
			onProgress: ({ total, updated }) => console.log(`[title-review-migration] ${updated}/${total} jobs updated`),
		});
		console.log(`[title-review-migration] ${cleanup.total} job(s) require cleanup or schema stamping`);
		if (dryRun) {
			console.log('[title-review-migration] dry run complete; no data was changed');
			return;
		}

		await initRedis();
		if (await initJobRankingCollection()) {
			await removeJobRankingPayloadField('titleRoles');
			const ranking = await rebuildTitleReviewRankingPayloads(jobsCollection, {
				onProgress: ({ indexed }) => console.log(`[title-review-migration] ${indexed} ranking payloads rebuilt`),
			});
			await bumpCatalogRevision();
			console.log('[title-review-migration] removed Qdrant titleRoles and rebuilt ranking payloads', ranking);
		} else {
			console.log('[title-review-migration] Qdrant is not configured; ranking rebuild skipped');
		}
		try {
			await rebuildAlgoliaJobs();
			console.log('[title-review-migration] rebuilt Algolia jobs index');
		} catch (error) {
			if (!/configuration is missing/i.test(String(error?.message || error))) throw error;
			console.log('[title-review-migration] Algolia is not configured; rebuild skipped');
		}

		console.log('[title-review-migration] complete', {
			updated: cleanup.updated,
			modelVersion: JOB_MARKET_MODEL_VERSION,
		});
	} finally {
		await closeRedis();
		await closeDataStore();
	}
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
	main().catch((error) => {
		console.error(error);
		process.exitCode = 1;
	});
}
