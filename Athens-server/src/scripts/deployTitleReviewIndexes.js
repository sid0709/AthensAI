#!/usr/bin/env node
import dotenv from 'dotenv';
import { GoogleAuth } from 'google-auth-library';

dotenv.config();

export const TITLE_REVIEW_INDEXES = [
	[
		['sourceCatalog', 'ASCENDING'],
		['titleReview.label', 'ASCENDING'],
		['postedAt', 'DESCENDING'],
	],
	[
		['sourceCatalog', 'ASCENDING'],
		['titleReview.label', 'ASCENDING'],
		['postedAt', 'ASCENDING'],
	],
	[
		['sourceCatalog', 'ASCENDING'],
		['titleReview.label', 'ASCENDING'],
		['titleReview.confidence', 'DESCENDING'],
		['postedAt', 'DESCENDING'],
	],
	[
		['sourceCatalog', 'ASCENDING'],
		['titleReview.processingState', 'ASCENDING'],
		['postedAt', 'DESCENDING'],
	],
	[
		['sourceCatalog', 'ASCENDING'],
		['titleReview.processingState', 'ASCENDING'],
		['postedAt', 'ASCENDING'],
	],
];

function signature(fields = []) {
	return fields
		.filter((field) => field.fieldPath !== '__name__')
		.map((field) => `${field.fieldPath}:${field.order || field.arrayConfig}`)
		.join('|');
}

function desiredSignature(fields) {
	return fields.map(([fieldPath, order]) => `${fieldPath}:${order}`).join('|');
}

function sleep(milliseconds) {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function deployTitleReviewIndexes({
	projectId = process.env.FIREBASE_PROJECT_ID,
	wait = false,
	pollMs = 5_000,
	log = console.log,
} = {}) {
	if (!projectId) throw new Error('FIREBASE_PROJECT_ID is required');
	const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/datastore'] });
	const client = await auth.getClient();
	const parent = `projects/${projectId}/databases/(default)/collectionGroups/jobs`;
	const listUrl = `https://firestore.googleapis.com/v1/${parent}/indexes`;

	const readIndexes = async () => {
		const { data } = await client.request({ url: listUrl });
		return data.indexes || [];
	};

	let indexes = await readIndexes();
	const existing = new Set(indexes.map((index) => signature(index.fields)));
	let created = 0;
	for (const fields of TITLE_REVIEW_INDEXES) {
		const wanted = desiredSignature(fields);
		if (existing.has(wanted)) continue;
		await client.request({
			url: listUrl,
			method: 'POST',
			data: {
				queryScope: 'COLLECTION',
				fields: fields.map(([fieldPath, order]) => ({ fieldPath, order })),
			},
		});
		created += 1;
		log(`[title-review-indexes] created ${wanted}`);
	}

	if (wait) {
		for (;;) {
			indexes = await readIndexes();
			const bySignature = new Map(indexes.map((index) => [signature(index.fields), index]));
			const states = TITLE_REVIEW_INDEXES.map((fields) => bySignature.get(desiredSignature(fields))?.state || 'MISSING');
			log(`[title-review-indexes] ${states.join(', ')}`);
			if (states.every((state) => state === 'READY')) break;
			if (states.some((state) => state === 'NEEDS_REPAIR')) {
				throw new Error('A title-review index needs repair');
			}
			await sleep(pollMs);
		}
	}

	indexes = await readIndexes();
	const bySignature = new Map(indexes.map((index) => [signature(index.fields), index]));
	return {
		created,
		indexes: TITLE_REVIEW_INDEXES.map((fields) => {
			const index = bySignature.get(desiredSignature(fields));
			return {
				signature: desiredSignature(fields),
				state: index?.state || 'MISSING',
				name: index?.name || null,
			};
		}),
	};
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const result = await deployTitleReviewIndexes({ wait: process.argv.includes('--wait') });
	console.log(JSON.stringify(result, null, 2));
}
