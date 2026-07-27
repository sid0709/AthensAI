import test from 'node:test';
import assert from 'node:assert/strict';
import {
  companyGroupDirectoryCacheKey,
  companyGroupedJobsTest,
} from './companyGroupedJobsService.js';

const { addStatusFilter, groupedPage, groupPayloads, orderRecommended, statusTab } = companyGroupedJobsTest;

function payload(jobId, companyId, postedAt = '2026-07-01T00:00:00.000Z') {
  return {
    jobId,
    companyId,
    postedAt,
    card: { title: jobId, company: { name: companyId } },
  };
}

test('filtered payloads group in first-member order', () => {
  const groups = groupPayloads([
    payload('a-new', 'acme'),
    payload('b-one', 'beta'),
    payload('a-old', 'acme'),
  ]);
  assert.deepEqual(groups.map((group) => group.companyId), ['acme', 'beta']);
  assert.deepEqual(groups[0].memberJobIds, ['a-new', 'a-old']);
});

test('best-match order uses the highest-ranked company member', () => {
  const rows = [payload('acme-low', 'acme'), payload('beta-high', 'beta'), payload('acme-high', 'acme')];
  const ordered = orderRecommended(rows, ['acme-high', 'beta-high', 'acme-low'], false);
  assert.deepEqual(groupPayloads(ordered).map((group) => group.companyId), ['acme', 'beta']);
});

test('company pagination never repeats a group across pages', () => {
  const groups = groupPayloads([
    payload('a', 'a'), payload('b', 'b'), payload('c', 'c'), payload('d', 'd'),
  ]);
  const jobsById = new Map(['a', 'b', 'c', 'd'].map((id) => [id, { _id: id }]));
  const first = groupedPage({ groups, page: 1, limit: 2, beta: false, jobsById, totalJobs: 4 });
  const second = groupedPage({ groups, page: 2, limit: 2, beta: false, jobsById, totalJobs: 4 });
  assert.deepEqual(first.data.map((group) => group.companyId), ['a', 'b']);
  assert.deepEqual(second.data.map((group) => group.companyId), ['c', 'd']);
});

test('public groups expose one job and no hidden role metadata', () => {
  const groups = groupPayloads([payload('a1', 'acme'), payload('a2', 'acme')]);
  const jobsById = new Map([['a1', { _id: 'a1' }], ['a2', { _id: 'a2' }]]);
  const response = groupedPage({ groups, page: 1, limit: 10, beta: false, jobsById, totalJobs: 2 });
  assert.equal(response.data[0].jobs.length, 1);
  assert.equal('matchingJobCount' in response.data[0], false);
  assert.equal('nextMemberOffset' in response.data[0], false);
  assert.equal(response.pagination.total, 1);
  assert.equal(response.pagination.totalJobs, 2);
});

test('beta groups expose two previews and continuation metadata', () => {
  const groups = groupPayloads([payload('a1', 'acme'), payload('a2', 'acme'), payload('a3', 'acme')]);
  const jobsById = new Map(['a1', 'a2', 'a3'].map((id) => [id, { _id: id }]));
  const response = groupedPage({ groups, page: 1, limit: 10, beta: true, jobsById, totalJobs: 3 });
  assert.equal(response.data[0].jobs.length, 2);
  assert.equal(response.data[0].matchingJobCount, 3);
  assert.equal(response.data[0].nextMemberOffset, 2);
});

test('status filters apply at job level before grouping', () => {
  const base = { must: [] };
  assert.equal(statusTab({ applied: false }), 'posted');
  assert.deepEqual(addStatusFilter(base, 'applied', ['job-1']).must.at(-1).has_id.length, 1);
  assert.equal(addStatusFilter(base, 'applied', []), null);
  assert.deepEqual(addStatusFilter(base, 'posted', ['job-1']).must_not.at(-1).has_id.length, 1);
});

test('directory cache separates filters, tier, catalog, ranking, and status revisions', () => {
  const base = {
    body: { q: 'react', sort: 'recommended' },
    account: { id: 'user', isBeta: false },
    catalogRevision: '1',
    statusRevision: '2',
    rankingVersion: '3',
  };
  const key = companyGroupDirectoryCacheKey(base);
  for (const changed of [
    { body: { q: 'python', sort: 'recommended' } },
    { account: { id: 'user', isBeta: true } },
    { catalogRevision: '9' },
    { statusRevision: '9' },
    { rankingVersion: '9' },
  ]) {
    assert.notEqual(companyGroupDirectoryCacheKey({ ...base, ...changed }), key);
  }
});

