import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { jobListReadModelTest } from './jobListReadModelService.js';

const {
  buildEntry,
  buildSourceFacets,
  finalizeSnapshot,
  matchesEntry,
  orderedIds,
  rankingReadinessStatus,
  responseCard,
  statusTab,
} = jobListReadModelTest;

test('REST responses expose ranking readiness for client polling', () => {
  assert.equal(rankingReadinessStatus(false, null, 'catalog-1'), 'fresh');
  assert.equal(rankingReadinessStatus(true, null, 'catalog-1'), 'warming');
  assert.equal(rankingReadinessStatus(true, {
    catalogRevision: 'catalog-0',
    stale: false,
  }, 'catalog-1'), 'stale');
  assert.equal(rankingReadinessStatus(true, {
    catalogRevision: 'catalog-1',
    stale: false,
  }, 'catalog-1'), 'fresh');
});

function payload(jobId, overrides = {}) {
  return {
    jobId,
    active: true,
    catalog: 'market',
    title: `Engineer ${jobId}`,
    companyName: 'Acme',
    companyId: 'acme',
    source: 'LinkedIn',
    postedAt: '2026-07-01T00:00:00.000Z',
    aiSkills: Array.from({ length: 12 }, (_, index) => ({
      name: `Skill ${index + 1}`,
      category: 'hard',
      requirement: (index % 5) + 1,
    })),
    card: {
      _id: jobId,
      title: `Engineer ${jobId}`,
      company: { name: 'Acme' },
      description: 'must not be copied into list cards',
      applyLink: `https://example.com/${jobId}`,
      details: { position: 'Chicago', remote: 'Hybrid', time: 'Full-time' },
    },
    ...overrides,
  };
}

test('the read snapshot precomputes stable newest, oldest, and title orders', () => {
  const snapshot = finalizeSnapshot([
    buildEntry(payload('older', { title: 'Zulu', postedAt: '2026-07-01T00:00:00.000Z' })),
    buildEntry(payload('newer', { title: 'Alpha', postedAt: '2026-07-02T00:00:00.000Z' })),
  ], 'catalog-1');
  assert.deepEqual(snapshot.idsByNewest, ['newer', 'older']);
  assert.deepEqual(snapshot.idsByOldest, ['older', 'newer']);
  assert.deepEqual(snapshot.idsByTitle, ['newer', 'older']);
});

test('list cards stay compact and expose at most eight skills', () => {
  const entry = buildEntry(payload('job-1'));
  const card = responseCard(entry, 'applied', { score: 87, covered: 7, required: 12 });
  assert.equal(card.viewerStatus, 'applied');
  assert.equal(card.aiSkills.length, 8);
  assert.equal(card.aiSkillCount, 12);
  assert.equal(card.description, undefined);
  assert.equal(card.matchScore, 87);
});

test('filters operate entirely on the compact in-memory projection', () => {
  const entry = buildEntry(payload('job-1', {
    companyTags: ['Software'],
    seniority: ['Senior'],
    titleRoles: ['Software Engineer'],
  }));
  const account = { isBeta: true };
  assert.equal(matchesEntry(entry, {
    q: 'engineer',
    'company.name': 'acm',
    'details.position': 'chicago',
    'details.remote': 'Hybrid',
    'details.time': 'Full-time',
    'details.seniority': 'Senior',
    'company.tags': 'Software',
    titleScanned: 'Software Engineer',
    jobSources: 'LinkedIn',
  }, account), true);
  assert.equal(matchesEntry(entry, { q: 'nurse', jobSources: 'LinkedIn' }, account), false);
});

test('unscanned jobs use a deterministic title-role fallback', () => {
  const software = buildEntry(payload('software', { title: 'Java Full Stack Developer' }));
  const platform = buildEntry(payload('platform', { title: 'Senior Platform Engineer' }));
  const account = { isBeta: true };
  assert.deepEqual(software.titleRoles, ['Software Engineer']);
  assert.deepEqual(platform.titleRoles, ['DevOps']);
  assert.equal(matchesEntry(software, { titleScanned: 'Software Engineer' }, account), true);
  assert.equal(matchesEntry(software, { titleScanned: 'DevOps' }, account), false);
});

test('status changes overlay a cached catalog ordering without rebuilding it', () => {
  const snapshot = finalizeSnapshot([
    buildEntry(payload('first', { postedAt: '2026-07-02T00:00:00.000Z' })),
    buildEntry(payload('second', { postedAt: '2026-07-01T00:00:00.000Z' })),
  ], 'catalog-1');
  const body = { sort: 'postedAt_desc', applied: true, status: 'Applied', jobSources: 'LinkedIn' };
  const statuses = { version: '1', byJobId: new Map([['second', 'applied']]) };
  assert.deepEqual(orderedIds(snapshot, body, { isBeta: true }, statuses, null), ['second']);
  statuses.byJobId.set('first', 'applied');
  statuses.byJobId.delete('second');
  assert.deepEqual(orderedIds(snapshot, body, { isBeta: true }, statuses, null), ['first']);
  assert.equal(statusTab({}), 'all');
});

test('source facets count posted jobs and ignore only the selected source filter', () => {
  const snapshot = finalizeSnapshot([
    buildEntry(payload('linkedin-posted')),
    buildEntry(payload('greenhouse-posted', { source: 'Greenhouse', postedAt: '2026-07-03T00:00:00.000Z' })),
    buildEntry(payload('greenhouse-applied', { source: 'Greenhouse' })),
    buildEntry(payload('beta-only', { source: 'Workday', extensionV2: true })),
  ], 'catalog-1');
  const statuses = {
    byJobId: new Map([['greenhouse-applied', 'applied']]),
  };
  const facets = buildSourceFacets(
    snapshot,
    { q: 'engineer', jobSources: 'LinkedIn' },
    { isBeta: false },
    statuses,
    null,
  );
  assert.deepEqual(facets.map(({ title, posted }) => ({ title, posted })), [
    { title: 'Greenhouse', posted: 1 },
    { title: 'LinkedIn', posted: 1 },
  ]);
  const dateFiltered = buildSourceFacets(
    snapshot,
    { q: 'engineer', jobSources: 'LinkedIn', postedAtFrom: '2026-07-02' },
    { isBeta: false },
    statuses,
    null,
  );
  assert.deepEqual(dateFiltered.map(({ title, posted }) => ({ title, posted })), [
    { title: 'Greenhouse', posted: 1 },
  ]);
});

test('15,000-job pages meet the hot read and payload budgets', () => {
  const entries = Array.from({ length: 15_000 }, (_, index) => buildEntry(payload(`job-${String(index).padStart(5, '0')}`, {
    postedAt: new Date(Date.UTC(2026, 6, 27) - index * 60_000).toISOString(),
    aiSkills: [{ name: 'TypeScript', category: 'hard', requirement: 4 }],
  })));
  const snapshot = finalizeSnapshot(entries, 'catalog-benchmark');
  const body = { sort: 'postedAt_desc', q: 'engineer' };
  const statuses = { version: '1', byJobId: new Map() };
  const started = performance.now();
  const ids = orderedIds(snapshot, body, { isBeta: true }, statuses, null);
  const elapsedMs = performance.now() - started;
  assert.equal(ids.length, 15_000);
  assert.ok(elapsedMs <= 100, `expected <=100ms, received ${elapsedMs.toFixed(1)}ms`);

  const response = {
    success: true,
    data: ids.slice(0, 100).map((id) => responseCard(snapshot.byId.get(id), 'posted', null)),
    pagination: { unit: 'jobs', page: 1, limit: 100, total: ids.length, totalPages: 150 },
  };
  const json = JSON.stringify(response);
  assert.ok(Buffer.byteLength(json) <= 200 * 1024);
  assert.ok(gzipSync(json).byteLength <= 60 * 1024);
});
