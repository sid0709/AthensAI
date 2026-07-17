import dotenv from 'dotenv';
dotenv.config();

import { initMongo, jobsCollection, closeMongo } from '../db/mongo.js';
import { initQdrantCollections, deleteJobVectorsCollection, isQdrantConfigured } from '../services/vectorStore/qdrantClient.js';
import { JOB_VECTORS_COLLECTION } from '../services/vectorStore/collections.js';

async function main() {
	await initMongo();

	if (!jobsCollection) {
		console.error('Database not ready');
		process.exit(1);
	}

	if (!isQdrantConfigured()) {
		console.error('QDRANT_URL not set. Add QDRANT_URL=http://127.0.0.1:6333 to .env');
		process.exit(1);
	}

	let qdrantCleared = false;
	try {
		await deleteJobVectorsCollection();
		await initQdrantCollections();
		qdrantCleared = true;
		console.log(`[reset-job-embeddings] cleared Qdrant collection "${JOB_VECTORS_COLLECTION}"`);
	} catch (err) {
		console.warn(`[reset-job-embeddings] Qdrant clear skipped: ${err.message}`);
	}

	const result = await jobsCollection.updateMany(
		{ embedding: { $exists: true } },
		{ $unset: { embedding: '' } },
	);

	console.log(
		`[reset-job-embeddings] Mongo jobs embedding unset: ${result.modifiedCount} `
		+ `(matched ${result.matchedCount}), qdrantCleared=${qdrantCleared}`,
	);

	await closeMongo?.();
	process.exit(0);
}

main().catch((err) => {
	console.error('reset-job-embeddings failed', err);
	process.exit(1);
});
