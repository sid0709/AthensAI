import test from 'node:test';
import assert from 'node:assert/strict';

import {
	finalizeTitleReviewSnapshot,
	patchTitleReviewReadModel,
	titleReviewReadModelTest,
} from './titleReviewReadModel.js';

function reviewRow(id, {
	title = `Job ${id}`,
	postedAt = '2026-07-01T00:00:00.000Z',
	label,
	processingState = 'completed',
	confidence,
} = {}) {
	return {
		id,
		title,
		company: 'Example',
		source: 'LinkedIn',
		postedAt,
		applyUrl: `https://example.test/${id}`,
		titleReview: { label, processingState, confidence },
	};
}

test.afterEach(() => titleReviewReadModelTest.reset());

test('precomputes queue counts and all review-required sort orders', () => {
	const snapshot = finalizeTitleReviewSnapshot([
		reviewRow('low', {
			label: 'REVIEW_REQUIRED', confidence: 0.4, postedAt: '2026-07-30T00:00:00.000Z',
		}),
		reviewRow('high-old', {
			label: 'REVIEW_REQUIRED', confidence: 0.95, postedAt: '2026-07-01T00:00:00.000Z',
		}),
		reviewRow('high-new', {
			label: 'REVIEW_REQUIRED', confidence: 0.95, postedAt: '2026-07-29T00:00:00.000Z',
		}),
		reviewRow('pending', { processingState: 'pending' }),
		reviewRow('scanning', { processingState: 'scanning' }),
		reviewRow('failed', { processingState: 'failed' }),
	], '42');

	assert.deepEqual(snapshot.counts, {
		pending: 2,
		unreviewedCount: 2,
		reviewRequiredCount: 3,
		failedCount: 1,
	});
	assert.deepEqual(
		snapshot.queues.review_required.confidence_desc.map((row) => row.id),
		['high-new', 'high-old', 'low'],
	);
	assert.deepEqual(
		snapshot.queues.review_required.newest.map((row) => row.id),
		['low', 'high-new', 'high-old'],
	);
	assert.deepEqual(
		snapshot.queues.review_required.oldest.map((row) => row.id),
		['high-old', 'high-new', 'low'],
	);
});

test('deduplicates queue scans by job id using the latest row', () => {
	const snapshot = finalizeTitleReviewSnapshot([
		reviewRow('same', { processingState: 'pending' }),
		reviewRow('same', { label: 'REVIEW_REQUIRED', confidence: 0.9 }),
	], '7');
	assert.equal(snapshot.entries.length, 1);
	assert.equal(snapshot.counts.unreviewedCount, 0);
	assert.equal(snapshot.counts.reviewRequiredCount, 1);
});

test('serves case-insensitive search and 500-row pagination entirely from memory', () => {
	const rows = Array.from({ length: 1_200 }, (_, index) => reviewRow(`job-${index}`, {
		title: index % 3 === 0 ? `MuleSoft Developer ${index}` : `Software Engineer ${index}`,
		label: 'REVIEW_REQUIRED',
		confidence: 1 - index / 2_000,
		postedAt: new Date(Date.UTC(2026, 0, 1 + (index % 28))).toISOString(),
	}));
	const snapshot = finalizeTitleReviewSnapshot(rows, '99');
	const result = titleReviewReadModelTest.listFromSnapshot(snapshot, {
		tab: 'review_required',
		sort: 'confidence_desc',
		q: 'mulesoft',
		page: 1,
		limit: 500,
	}, 'memory', { startedAt: performance.now(), cacheLookupMs: 0 });

	assert.equal(result.pagination.total, 400);
	assert.equal(result.pagination.limit, 500);
	assert.equal(result.data.length, 400);
	assert.equal(result.meta.cacheSource, 'memory');
	assert.ok(result.data.every((row) => row.title.includes('MuleSoft')));
	assert.ok(result.data[0].titleReview.confidence >= result.data.at(-1).titleReview.confidence);
});

test('Redis serialization round-trips compact rows and rebuilds sort indexes', () => {
	const snapshot = finalizeTitleReviewSnapshot([
		reviewRow('one', { label: 'REVIEW_REQUIRED', confidence: 0.7 }),
		reviewRow('two', { processingState: 'pending' }),
	], '123');
	const raw = titleReviewReadModelTest.serializeSnapshot(snapshot);
	const parsed = titleReviewReadModelTest.parseSnapshot(raw, '123');
	assert.equal(parsed.revision, '123');
	assert.equal(parsed.entries.length, 2);
	assert.equal(parsed.queues.review_required.confidence_desc[0].id, 'one');
	assert.equal(parsed.queues.unreviewed.newest[0].id, 'two');
	assert.equal(titleReviewReadModelTest.parseSnapshot(raw, '124'), null);
});

test('small inserts patch a warm snapshot instead of invalidating it', async () => {
	const initial = finalizeTitleReviewSnapshot([
		reviewRow('existing', { label: 'REVIEW_REQUIRED', confidence: 0.8 }),
	], '1');
	titleReviewReadModelTest.seed(initial);

	const result = await patchTitleReviewReadModel({
		upsertRows: [reviewRow('new-pending', { processingState: 'pending' })],
	});
	const current = titleReviewReadModelTest.current();
	assert.equal(result.patched, true);
	assert.equal(current.revision, '2');
	assert.equal(current.counts.reviewRequiredCount, 1);
	assert.equal(current.counts.unreviewedCount, 1);
	assert.deepEqual(current.queues.unreviewed.newest.map((row) => row.id), ['new-pending']);
});

test('stale snapshots expose both authoritative and snapshot revisions', () => {
	const snapshot = finalizeTitleReviewSnapshot([
		reviewRow('one', { label: 'REVIEW_REQUIRED', confidence: 0.9 }),
	], '10');
	const result = titleReviewReadModelTest.listFromSnapshot(
		snapshot,
		{ tab: 'review_required', limit: 500 },
		'memory',
		{ startedAt: performance.now(), cacheLookupMs: 0 },
		{ revision: '11', stale: true },
	);
	assert.equal(result.meta.revision, '11');
	assert.equal(result.meta.snapshotRevision, '10');
	assert.equal(result.meta.stale, true);
});
