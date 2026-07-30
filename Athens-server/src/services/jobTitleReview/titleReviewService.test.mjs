import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TITLE_REVIEW_BATCH_SIZE,
  classifyAndPersistTitleReviewBatch,
  parseTitleReviewJson,
} from './titleReviewService.js';
import { TITLE_REVIEW_CONCURRENCY, pendingTitleReviewQuery } from './titleReviewSession.js';
import { buildJobsListQuery } from '../jobListQuery.js';

const expected = [
  { index: 0, title: 'Software Engineer' },
  { index: 1, title: 'QA Engineer' },
];

test('accepts exact index and title matches', () => {
  const parsed = parseTitleReviewJson(JSON.stringify({ results: [
    { index: 0, title: 'Software Engineer', label: 'APPROVED', confidence: 0.98, reason: 'Hands-on software work.' },
    { index: 1, title: 'QA Engineer', label: 'REVIEW_REQUIRED', confidence: 1, reason: 'Testing-focused title.' },
  ] }), expected);
  assert.equal(parsed.errors.size, 0);
  assert.equal(parsed.valid.get(0).label, 'APPROVED');
  assert.equal(parsed.valid.get(1).label, 'REVIEW_REQUIRED');
});

test('rejects malformed JSON for every expected title', () => {
  const parsed = parseTitleReviewJson('{bad', expected);
  assert.equal(parsed.valid.size, 0);
  assert.deepEqual([...parsed.errors.values()].map((error) => error.code), ['INVALID_JSON', 'INVALID_JSON']);
});

test('rejects mismatched titles without affecting valid siblings', () => {
  const parsed = parseTitleReviewJson(JSON.stringify({ results: [
    { index: 0, title: 'software engineer', label: 'APPROVED', confidence: 0.9, reason: 'Wrong casing.' },
    { index: 1, title: 'QA Engineer', label: 'REVIEW_REQUIRED', confidence: 0.9, reason: 'Testing role.' },
  ] }), expected);
  assert.equal(parsed.errors.get(0).code, 'TITLE_MISMATCH');
  assert.equal(parsed.valid.get(1).label, 'REVIEW_REQUIRED');
});

test('rejects duplicate and missing indexes individually', () => {
  const parsed = parseTitleReviewJson(JSON.stringify({ results: [
    { index: 0, title: 'Software Engineer', label: 'APPROVED', confidence: 0.9, reason: 'Software.' },
    { index: 0, title: 'Software Engineer', label: 'APPROVED', confidence: 0.9, reason: 'Duplicate.' },
  ] }), expected);
  assert.equal(parsed.errors.get(0).code, 'DUPLICATE_INDEX');
  assert.equal(parsed.errors.get(1).code, 'MISSING_RESULT');
});

test('rejects invalid labels, confidence, and reasons', () => {
  const badLabel = parseTitleReviewJson(JSON.stringify({ results: [
    { index: 0, title: 'Software Engineer', label: 'MAYBE', confidence: 0.9, reason: 'No.' },
  ] }), expected.slice(0, 1));
  assert.equal(badLabel.errors.get(0).code, 'INVALID_LABEL');

  const badConfidence = parseTitleReviewJson(JSON.stringify({ results: [
    { index: 0, title: 'Software Engineer', label: 'APPROVED', confidence: 2, reason: 'No.' },
  ] }), expected.slice(0, 1));
  assert.equal(badConfidence.errors.get(0).code, 'INVALID_CONFIDENCE');

  const badReason = parseTitleReviewJson(JSON.stringify({ results: [
    { index: 0, title: 'Software Engineer', label: 'APPROVED', confidence: 0.9, reason: '   ' },
  ] }), expected.slice(0, 1));
  assert.equal(badReason.errors.get(0).code, 'INVALID_REASON');
});

test('throughput guardrails cap each request at ten titles and ten concurrent requests', () => {
  assert.ok(TITLE_REVIEW_BATCH_SIZE >= 1 && TITLE_REVIEW_BATCH_SIZE <= 10);
  assert.ok(TITLE_REVIEW_CONCURRENCY >= 1 && TITLE_REVIEW_CONCURRENCY <= 10);
});

test('the review session claims only indexed pending and failed states', () => {
  assert.deepEqual(pendingTitleReviewQuery(), {
    'titleReview.processingState': { $in: ['pending', 'failed'] },
  });
});

test('compatibility Job Search shows only explicitly approved titles', async () => {
  const { query } = await buildJobsListQuery({});
  assert.ok(query.$and.some((clause) => clause['titleReview.label'] === 'APPROVED'));
});

test('invalid model rows store failure metadata without classification fields', async () => {
  const writes = [];
  const result = await classifyAndPersistTitleReviewBatch(
    [{ _id: 'job-1', title: 'QA Engineer' }],
    { providerId: 'test', apiKey: 'test', model: 'test', applierName: 'test' },
    {
      sessionId: 'session-1',
      complete: async () => ({ content: JSON.stringify({ results: [
        { index: 0, title: 'QA engineer', label: 'REVIEW_REQUIRED', confidence: 1, reason: 'Testing.' },
      ] }) }),
      collection: {
        updateOne: async (filter, update) => {
          writes.push({ filter, update });
          return { modifiedCount: 1 };
        },
      },
      syncUpdates: async () => assert.fail('invalid rows must not synchronize a label'),
    },
  );
  assert.equal(result.failed, 1);
  assert.equal(result.reviewRequired, 0);
  assert.deepEqual(writes[0].filter, {
    _id: 'job-1',
    title: 'QA Engineer',
    'titleReview.lease.sessionId': 'session-1',
  });
  assert.equal(writes[0].update.$set['titleReview.processingState'], 'failed');
  assert.equal(writes[0].update.$set['titleReview.label'], undefined);
  assert.equal(writes[0].update.$set.titleReview, undefined);
});

test('stale title or lease responses never persist or synchronize an AI label', async () => {
  const writes = [];
  let synchronized = false;
  const result = await classifyAndPersistTitleReviewBatch(
    [{ _id: 'job-1', title: 'Software Engineer' }],
    { providerId: 'test', apiKey: 'test', model: 'test', applierName: 'test' },
    {
      sessionId: 'old-session',
      complete: async () => ({ content: JSON.stringify({ results: [
        { index: 0, title: 'Software Engineer', label: 'APPROVED', confidence: 0.99, reason: 'Software work.' },
      ] }) }),
      collection: {
        updateOne: async (filter, update) => {
          writes.push({ filter, update });
          return { modifiedCount: writes.length === 1 ? 0 : 1 };
        },
      },
      syncUpdates: async () => { synchronized = true; },
    },
  );
  assert.equal(result.approved, 0);
  assert.equal(result.failed, 1);
  assert.equal(synchronized, false);
  assert.equal(writes[0].filter.title, 'Software Engineer');
  assert.equal(writes[0].filter['titleReview.lease.sessionId'], 'old-session');
  assert.deepEqual(writes[1].update, {
    $set: { 'titleReview.processingState': 'pending' },
    $unset: { 'titleReview.lease': '', 'titleReview.error': '' },
  });
});
