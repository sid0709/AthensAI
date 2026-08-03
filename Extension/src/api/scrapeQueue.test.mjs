import test from 'node:test';
import assert from 'node:assert/strict';
import {
	classifyBulkItem,
	incrementRunOutcome,
	isRetryableBulkItem,
	normalizeQueueState,
	queueCounts,
	selectReadyItems,
} from './scrapeQueue.js';

test('restores interrupted saving items as queued after a worker restart', () => {
	const state = normalizeQueueState({ items: [{ id: '1', runId: 'run', job: {}, status: 'saving' }] });
	assert.equal(state.items[0].status, 'queued');
});

test('counts queued and saving work by run', () => {
	const items = [
		{ runId: 'a', status: 'queued' },
		{ runId: 'a', status: 'saving' },
		{ runId: 'b', status: 'queued' },
	];
	assert.deepEqual(queueCounts(items, 'a'), { queued: 1, saving: 1 });
});

test('selects at most five ready jobs for one bulk request', () => {
	const items = Array.from({ length: 7 }, (_, index) => ({
		id: String(index),
		status: 'queued',
		nextAttemptAt: index === 6 ? 2_000 : 0,
	}));
	assert.deepEqual(selectReadyItems(items, 1_000).map(({ id }) => id), ['0', '1', '2', '3', '4']);
});

test('classifies canonical bulk results and retries only server failures', () => {
	assert.equal(classifyBulkItem({ created: true }), 'registered');
	assert.equal(classifyBulkItem({ duplicate: true }), 'duplicate');
	assert.equal(classifyBulkItem({ reason: 'Blocked by rule: test' }), 'blocked');
	assert.equal(isRetryableBulkItem({ statusCode: 503 }), true);
	assert.equal(isRetryableBulkItem({ statusCode: 422 }), false);
});

test('persists independent run outcome totals', () => {
	const runs = incrementRunOutcome({}, 'run-a', 'registered');
	assert.equal(runs['run-a'].registered, 1);
	assert.equal(runs['run-a'].failed, 0);
});
