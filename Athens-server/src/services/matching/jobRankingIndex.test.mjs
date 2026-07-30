import test from 'node:test';
import assert from 'node:assert/strict';
import { buildJobRankingPayload, buildJobRankingPoint, filterDateTailCandidates } from './jobRankingIndex.js';
import { buildJobRankingFilter, queryExcludesExtensionV2Jobs } from './jobRankingService.js';

test('ranking payload carries indexed global filter fields', () => {
  const payload = buildJobRankingPayload({
    title: 'Senior Engineer',
    company: { name: 'Athens', tags: ['SaaS'] },
    details: { position: 'Seattle', remote: 'Hybrid', seniority: ['Senior'] },
    titleReview: { label: 'REVIEW_REQUIRED' },
    source: 'LinkedIn',
    aiSkills: [{ name: 'React', category: 'hard', requirement: 5 }],
  });
  assert.deepEqual(payload.companyTags, ['SaaS']);
  assert.equal(payload.aiExtracted, true);
  assert.equal(payload.workMode, 'Hybrid');
  assert.equal(payload.card.title, 'Senior Engineer');
  assert.equal(payload.card.company.name, 'Athens');
  assert.equal(payload.card.status, undefined);
  assert.equal(payload.titleReviewLabel, 'REVIEW_REQUIRED');
  assert.equal(payload.rankingSchemaVersion, 4);
  assert.match(payload.companyId, /^cmp_/);
  assert.equal(payload.card.companyId, payload.companyId);
  assert.deepEqual(payload.rankSkills, [['React', 0, 5]]);
});

test('jobs without extracted skills remain countable but cannot match a real skill id', () => {
  const point = buildJobRankingPoint({ _id: 'job-1', title: 'Engineer' });
  assert.deepEqual(point.skillsSparse, { indices: [0], values: [1] });
});

test('unreviewed jobs carry no quarantine label', () => {
  assert.equal(buildJobRankingPayload({ title: 'Machine Learning Engineer' }).titleReviewLabel, '');
});

test('legacy string skills are retained in compact reranking payloads', () => {
  const payload = buildJobRankingPayload({ aiSkills: ['React', 'Node.js'] });
  assert.deepEqual(payload.rankSkills, [['React', 0, 1], ['Node.js', 0, 1]]);
});

test('retrieval filter includes industry, extraction, and non-beta clauses', () => {
  const filter = buildJobRankingFilter({
    'company.tags': 'SaaS',
    aiExtracted: true,
  }, { dataQuery: { $and: [{ version: { $ne: 'v2' } }] } });
  assert.ok(filter.must.some((clause) => clause.key === 'companyTags'));
  assert.ok(filter.must.some((clause) => clause.key === 'aiExtracted'));
  assert.ok(filter.must.some((clause) => clause.key === 'extensionV2'));
  assert.ok(filter.must_not.some((clause) => clause.key === 'version' && clause.match?.value === 'v2'));
  assert.ok(filter.must_not.some((clause) => clause.key === 'titleReviewLabel' && clause.match?.value === 'REVIEW_REQUIRED'));
});

test('ranking payload marks both v2 provenance shapes as beta-only', () => {
  assert.equal(buildJobRankingPayload({ version: 'v2' }).extensionV2, true);
  assert.equal(buildJobRankingPayload({ version: 'v2' }).version, 'v2');
  assert.equal(buildJobRankingPayload({ extensionV2: true }).extensionV2, true);
  assert.equal(buildJobRankingPayload({ version: 'v1' }).extensionV2, false);
});

test('non-beta date tail fails closed for v2 and missing ranking payloads', () => {
  const candidates = [
    { jobId: 'public', catalog: 'market' },
    { jobId: 'v2', catalog: 'market' },
    { jobId: 'missing', catalog: 'market' },
  ];
  const payloads = [
    { jobId: 'public', extensionV2: false },
    { jobId: 'v2', extensionV2: true },
  ];
  assert.deepEqual(filterDateTailCandidates(candidates, payloads, { excludeExtensionV2: true }), [candidates[0]]);
  assert.deepEqual(filterDateTailCandidates(candidates, payloads), candidates);
});

test('date tail excludes review-required jobs while retaining unprocessed jobs', () => {
  const candidates = [
    { jobId: 'approved', catalog: 'market' },
    { jobId: 'review', catalog: 'market' },
    { jobId: 'unprocessed', catalog: 'market' },
    { jobId: 'missing-payload', catalog: 'market' },
  ];
  const payloads = [
    { jobId: 'approved', titleReviewLabel: 'APPROVED' },
    { jobId: 'review', titleReviewLabel: 'REVIEW_REQUIRED' },
    { jobId: 'unprocessed' },
  ];
  assert.deepEqual(
    filterDateTailCandidates(candidates, payloads, { excludeReviewRequired: true }),
    [candidates[0], candidates[2]],
  );
});

test('v2 exclusion is detected in indexed and compatibility query shapes', () => {
  assert.equal(queryExcludesExtensionV2Jobs({ extensionV2: false }), true);
  assert.equal(queryExcludesExtensionV2Jobs({ $and: [{ version: { $ne: 'v2' } }] }), true);
  assert.equal(queryExcludesExtensionV2Jobs({ $and: [{ extensionV2: { $ne: true } }] }), true);
  assert.equal(queryExcludesExtensionV2Jobs({}), false);
});
