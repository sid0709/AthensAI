import test from 'node:test';
import assert from 'node:assert/strict';
import { buildJobRankingPayload, buildJobRankingPoint } from './jobRankingIndex.js';
import { buildJobRankingFilter } from './jobRankingService.js';

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
