import test from 'node:test';
import assert from 'node:assert/strict';
import { createLimiter } from '../utils/concurrency.js';
import { ingestJobsBulk, summarizeJobBulkResults } from './jobBulkIngest.js';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('bulk ingest preserves order and respects its concurrency limit', async () => {
	let active = 0;
	let peak = 0;
	const jobs = Array.from({ length: 8 }, (_, index) => ({ title: `Job ${index}` }));
	const limiter = createLimiter({ concurrency: 3 });

	const output = await ingestJobsBulk(jobs, async (_job, index) => {
		active += 1;
		peak = Math.max(peak, active);
		await delay(index % 2 === 0 ? 12 : 4);
		active -= 1;
		return { statusCode: 201, payload: { success: true, created: true, insertedId: `id-${index}` } };
	}, { limiter });

	assert.equal(peak, 3);
	assert.deepEqual(output.results.map((result) => result.index), [0, 1, 2, 3, 4, 5, 6, 7]);
	assert.deepEqual(output.results.map((result) => result.insertedId), jobs.map((_, index) => `id-${index}`));
	assert.deepEqual(output.summary, { total: 8, created: 8, duplicate: 0, blocked: 0, errors: 0 });
});

test('bulk ingest isolates failures and summarizes every result type', async () => {
	const outputs = [
		{ statusCode: 201, payload: { success: true, created: true } },
		{ statusCode: 200, payload: { success: false, created: false, duplicate: true, reason: 'Duplicate job' } },
		{ statusCode: 200, payload: { success: false, created: false, reason: 'Blocked by rule: agency' } },
	];
	const { results, summary } = await ingestJobsBulk([0, 1, 2, 3], async (_job, index) => {
		if (index === 3) throw new Error('Firestore unavailable');
		return outputs[index];
	}, { limiter: createLimiter({ concurrency: 2 }) });

	assert.equal(results[3].statusCode, 500);
	assert.equal(results[3].error, 'Firestore unavailable');
	assert.deepEqual(summary, { total: 4, created: 1, duplicate: 1, blocked: 1, errors: 1 });
});

test('summary treats validation responses as errors', () => {
	assert.deepEqual(summarizeJobBulkResults([
		{ statusCode: 400, error: 'Job title cannot be empty' },
	]), { total: 1, created: 0, duplicate: 0, blocked: 0, errors: 1 });
});
