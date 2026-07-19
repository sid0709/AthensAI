/**
 * Unit tests for SessionMatching — run with: node background/session-matching.test.js
 */
const assert = require('assert');
const { SessionMatching } = require('./session-matching.js');

function testExtractDomain() {
  assert.strictEqual(SessionMatching.extractDomain('https://www.acme.com/jobs/1'), 'acme.com');
  assert.strictEqual(SessionMatching.extractDomain('https://company.myworkdayjobs.com/en-US/careers'), 'company.myworkdayjobs.com');
  assert.strictEqual(SessionMatching.extractDomain('not-a-url'), '');
}

function testMailAndAts() {
  assert.ok(SessionMatching.isExternalMailDomain('mail.google.com'));
  assert.ok(SessionMatching.isExternalMailDomain('outlook.office.com'));
  assert.ok(!SessionMatching.isExternalMailDomain('acme.com'));
  assert.ok(SessionMatching.isKnownAtsDomain('company.myworkdayjobs.com'));
  assert.ok(SessionMatching.isKnownAtsDomain('boards.greenhouse.io'));
  assert.ok(SessionMatching.isKnownAtsDomain('jobs.lever.co'));
  assert.ok(SessionMatching.isKnownAtsDomain('jobs.ashbyhq.com'));
  assert.ok(!SessionMatching.isKnownAtsDomain('news.ycombinator.com'));
}

function testActiveFilter() {
  const sessions = [
    { sessionId: 'a', status: 'recording' },
    { sessionId: 'b', status: 'completed' },
    { sessionId: 'c', status: 'needs_merge' },
    { sessionId: 'd', status: 'waiting_verification' },
    { sessionId: 'e', status: 'discarded' },
  ];
  const active = SessionMatching.activeSessionsFilter(sessions);
  assert.deepStrictEqual(
    active.map((s) => s.sessionId).sort(),
    ['a', 'c', 'd'],
  );
}

function testMatchOpenerAuto() {
  const sessions = [
    {
      sessionId: 's1',
      status: 'recording',
      originalDomain: 'acme.com',
      activeTabIds: [10],
    },
  ];
  const result = SessionMatching.matchSessionForTab({
    openerTabId: 10,
    domain: 'verify.acme.com',
    sessions,
    tabIndex: { '10': 's1' },
  });
  assert.strictEqual(result.action, 'auto');
  assert.strictEqual(result.recommendedSessionId, 's1');
}

function testMatchExactDomainSuggest() {
  const sessions = [
    { sessionId: 's1', status: 'recording', originalDomain: 'acme.com', activeTabIds: [1] },
  ];
  const result = SessionMatching.matchSessionForTab({
    openerTabId: null,
    domain: 'acme.com',
    sessions,
    tabIndex: {},
  });
  assert.strictEqual(result.action, 'suggest');
  assert.strictEqual(result.recommendedSessionId, 's1');
}

function testMatchMultiWorkdayAsk() {
  const sessions = [
    { sessionId: 's1', status: 'recording', originalDomain: 'a.myworkdayjobs.com', activeTabIds: [1] },
    { sessionId: 's2', status: 'recording', originalDomain: 'b.myworkdayjobs.com', activeTabIds: [2] },
  ];
  const result = SessionMatching.matchSessionForTab({
    openerTabId: null,
    domain: 'wd5.myworkdaysite.com',
    sessions,
    tabIndex: {},
  });
  assert.strictEqual(result.action, 'ask');
  assert.strictEqual(result.recommendedSessionId, null);
  assert.strictEqual(result.sessionIds.length, 2);
}

function testGmailNeverAttach() {
  const sessions = [
    { sessionId: 's1', status: 'recording', originalDomain: 'acme.com', activeTabIds: [1] },
  ];
  const result = SessionMatching.matchSessionForTab({
    openerTabId: null,
    domain: 'mail.google.com',
    sessions,
    tabIndex: {},
  });
  assert.strictEqual(result.action, 'none');

  const withTrackedOpener = SessionMatching.matchSessionForTab({
    openerTabId: 1,
    domain: 'mail.google.com',
    sessions,
    tabIndex: { '1': 's1' },
  });
  assert.strictEqual(withTrackedOpener.action, 'none');
}

function testMergeAndOrder() {
  const session = {
    sessionId: 's1',
    status: 'recording',
    activeTabIds: [1],
    recordingSegmentIds: ['seg1'],
  };
  const segment = { segmentId: 'seg2', tabId: 2 };
  const merged = SessionMatching.mergeSegmentIntoSession(session, segment);
  assert.ok(merged.recordingSegmentIds.includes('seg2'));
  assert.ok(merged.activeTabIds.includes(2));

  const ordered = SessionMatching.orderSegmentsForFinalVideo([
    { segmentId: 'b', startedAt: '2026-01-02T00:00:00.000Z', status: 'merged', sessionId: 's1' },
    { segmentId: 'a', startedAt: '2026-01-01T00:00:00.000Z', status: 'merged', sessionId: 's1' },
    { segmentId: 'c', startedAt: '2026-01-03T00:00:00.000Z', status: 'discarded', sessionId: 's1' },
    { segmentId: 'd', startedAt: '2026-01-04T00:00:00.000Z', status: 'unassigned' },
  ]);
  assert.deepStrictEqual(
    ordered.map((s) => s.segmentId),
    ['a', 'b'],
  );
}

function run() {
  testExtractDomain();
  testMailAndAts();
  testActiveFilter();
  testMatchOpenerAuto();
  testMatchExactDomainSuggest();
  testMatchMultiWorkdayAsk();
  testGmailNeverAttach();
  testMergeAndOrder();
  console.log('session-matching.test.js: all passed');
}

run();
