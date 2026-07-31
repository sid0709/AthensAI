import test from 'node:test';
import assert from 'node:assert/strict';

import {
	TitleReviewQueryError,
	buildTitleReviewFirestoreQuery,
	mapTitleReviewDocument,
	normalizeTitleReviewRequest,
	titleReviewQueryServiceTest,
} from './titleReviewQueryService.js';

class RecordingQuery {
	constructor() {
		this.operations = [];
	}

	where(...args) {
		this.operations.push(['where', ...args]);
		return this;
	}

	orderBy(...args) {
		this.operations.push(['orderBy', ...args]);
		return this;
	}
}

test('normalizes title-review pagination and conservative defaults', () => {
	assert.deepEqual(
		normalizeTitleReviewRequest({ tab: 'review_required', page: 2.9, limit: 5_000 }),
		{ tab: 'review_required', page: 2, limit: 500, sort: 'confidence_desc', q: '' },
	);
	assert.deepEqual(
		normalizeTitleReviewRequest({ tab: 'unknown', sort: 'unknown', q: '  MuleSoft  ' }),
		{ tab: 'unreviewed', page: 1, limit: 50, sort: 'newest', q: 'MuleSoft' },
	);
});

test('builds the exact confidence index query without a compatibility scan', () => {
	const query = buildTitleReviewFirestoreQuery(new RecordingQuery(), {
		tab: 'review_required',
		sort: 'confidence_desc',
	});
	assert.deepEqual(query.operations, [
		['where', 'sourceCatalog', '==', 'market'],
		['where', 'titleReview.label', '==', 'REVIEW_REQUIRED'],
		['orderBy', 'titleReview.confidence', 'desc'],
		['orderBy', 'postedAt', 'desc'],
	]);
});

test('builds newest/oldest native queue queries for every tab', () => {
	const failed = buildTitleReviewFirestoreQuery(new RecordingQuery(), { tab: 'failed', sort: 'oldest' });
	assert.deepEqual(failed.operations, [
		['where', 'sourceCatalog', '==', 'market'],
		['where', 'titleReview.processingState', '==', 'failed'],
		['orderBy', 'postedAt', 'asc'],
	]);

	const unreviewed = buildTitleReviewFirestoreQuery(new RecordingQuery(), { tab: 'unreviewed' });
	assert.deepEqual(unreviewed.operations, [
		['where', 'sourceCatalog', '==', 'market'],
		['where', 'titleReview.processingState', 'in', ['pending', 'scanning']],
		['orderBy', 'postedAt', 'desc'],
	]);
});

test('maps only the compact review row contract', () => {
	const row = mapTitleReviewDocument({
		id: 'job-1',
		data: () => ({
			title: 'MuleSoft Developer',
			company: { name: 'Example Co' },
			source: 'LinkedIn',
			postedAt: { toDate: () => new Date('2026-07-30T10:00:00.000Z') },
			jobLink: 'https://example.test/job-1',
			titleReview: { label: 'REVIEW_REQUIRED', confidence: 0.99 },
			largeDescription: 'must not leak into the compact row',
		}),
	});
	assert.deepEqual(row, {
		id: 'job-1',
		title: 'MuleSoft Developer',
		company: 'Example Co',
		source: 'LinkedIn',
		postedAt: '2026-07-30T10:00:00.000Z',
		applyUrl: 'https://example.test/job-1',
		titleReview: { label: 'REVIEW_REQUIRED', confidence: 0.99 },
	});
});

test('missing composite indexes fail fast with a retryable typed error', () => {
	const error = titleReviewQueryServiceTest.classifyFirestoreError({
		code: 9,
		message: 'The query requires an index.',
	});
	assert.ok(error instanceof TitleReviewQueryError);
	assert.equal(error.code, 'TITLE_REVIEW_INDEX_NOT_READY');
	assert.equal(error.status, 503);
	assert.equal(error.retryAfter, 5);
});
