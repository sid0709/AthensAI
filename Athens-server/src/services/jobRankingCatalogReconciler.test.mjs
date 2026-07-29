import test from 'node:test';
import assert from 'node:assert/strict';
import {
	jobRankingCatalogReconcilerTest,
	reconcileIndexedJobCatalog,
} from './jobRankingCatalogReconciler.js';

const { canonicalCatalog, uniqueEntries } = jobRankingCatalogReconcilerTest;

function fakeFirestore(rows) {
	return {
		collection() {
			return { doc: (id) => ({ id }) };
		},
		async getAll(...args) {
			const refs = args.slice(0, -1);
			return refs.map(({ id }) => {
				const row = rows.get(id);
				return {
					exists: row !== undefined,
					data: () => row,
				};
			});
		},
	};
}

test('catalog names default to market and normalize external values', () => {
	assert.equal(canonicalCatalog(undefined), 'market');
	assert.equal(canonicalCatalog('EXTERNAL'), 'external');
	assert.deepEqual(uniqueEntries([
		{ id: 'one', catalog: 'market' },
		{ jobId: 'one', catalog: 'external' },
		{ id: 'two' },
	]), [
		{ id: 'one', catalog: 'external' },
		{ id: 'two', catalog: 'market' },
	]);
});

test('reconciliation evicts and removes missing or catalog-mismatched entries', async () => {
	const removed = [];
	const evicted = [];
	const result = await reconcileIndexedJobCatalog([
		{ id: 'market-ok', catalog: 'market' },
		{ id: 'legacy-market', catalog: 'market' },
		{ id: 'external-ok', catalog: 'external' },
		{ id: 'missing', catalog: 'market' },
		{ id: 'wrong-catalog', catalog: 'external' },
	], {
		firestore: fakeFirestore(new Map([
			['market-ok', { sourceCatalog: 'market' }],
			['legacy-market', {}],
			['external-ok', { sourceCatalog: 'external' }],
			['wrong-catalog', { sourceCatalog: 'market' }],
		])),
		removeRanking: async (ids) => removed.push(...ids),
		onStale: (ids) => evicted.push(...ids),
		batchSize: 2,
		concurrency: 2,
		acquireLock: false,
	});

	assert.equal(result.scanned, 5);
	assert.equal(result.removed, 2);
	assert.deepEqual(new Set(result.staleIds), new Set(['missing', 'wrong-catalog']));
	assert.deepEqual(new Set(removed), new Set(['missing', 'wrong-catalog']));
	assert.deepEqual(new Set(evicted), new Set(['missing', 'wrong-catalog']));
});
