import test from 'node:test';
import assert from 'node:assert/strict';
import { buildJobRankingPayload, buildJobRankingPoint, filterDateTailCandidates } from './jobRankingIndex.js';
import { buildJobRankingFilter, queryExcludesExtensionV2Jobs } from './jobRankingService.js';

test('ranking payload carries indexed global filter fields', () => {
  const payload = buildJobRankingPayload({
    title: 'Senior Engineer',
    company: { name: 'Athens', tags: ['SaaS'] },
    details: { position: 'Seattle', remote: 'Hybrid', seniority: ['Senior'] },
    titleScanned: ['Software Engineer'],
    source: 'LinkedIn',
    aiSkills: [{ name: 'React', category: 'hard', requirement: 5 }],
  });
  assert.deepEqual(payload.companyTags, ['SaaS']);
  assert.equal(payload.aiExtracted, true);
  assert.equal(payload.workMode, 'Hybrid');
  assert.equal(payload.card.title, 'Senior Engineer');
  assert.equal(payload.card.company.name, 'Athens');
  assert.equal(payload.card.status, undefined);
  assert.deepEqual(payload.rankSkills, [['React', 0, 5]]);
});

test('jobs without extracted skills remain countable but cannot match a real skill id', () => {
  const point = buildJobRankingPoint({ _id: 'job-1', title: 'Engineer' });
  assert.deepEqual(point.skillsSparse, { indices: [0], values: [1] });
});

test('legacy string skills are retained in compact reranking payloads', () => {
  const payload = buildJobRankingPayload({ aiSkills: ['React', 'Node.js'] });
  assert.deepEqual(payload.rankSkills, [['React', 0, 1], ['Node.js', 0, 1]]);
});

test('retrieval filter includes industry, extraction, and non-beta clauses', () => {
  const filter = buildJobRankingFilter({
    'company.tags': 'SaaS',
    aiExtracted: true,
  }, { mongoQuery: { $and: [{ version: { $ne: 'v2' } }] } });
  assert.ok(filter.must.some((clause) => clause.key === 'companyTags'));
  assert.ok(filter.must.some((clause) => clause.key === 'aiExtracted'));
  assert.ok(filter.must.some((clause) => clause.key === 'extensionV2'));
});

test('ranking payload marks both v2 provenance shapes as beta-only', () => {
  assert.equal(buildJobRankingPayload({ version: 'v2' }).extensionV2, true);
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

test('v2 exclusion is detected in Firestore and MongoDB query shapes', () => {
  assert.equal(queryExcludesExtensionV2Jobs({ extensionV2: false }), true);
  assert.equal(queryExcludesExtensionV2Jobs({ $and: [{ version: { $ne: 'v2' } }] }), true);
  assert.equal(queryExcludesExtensionV2Jobs({ $and: [{ extensionV2: { $ne: true } }] }), true);
  assert.equal(queryExcludesExtensionV2Jobs({}), false);
});
