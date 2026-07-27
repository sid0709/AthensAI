import test from 'node:test';
import assert from 'node:assert/strict';
import {
  jobStatusContribution,
  mergeJobStatusRows,
  resolveJobStatusState,
} from './job-status.js';

test('canonical status resolution preserves one independent state per profile', () => {
  const rows = [
    { applier: 'a', appliedDate: '2026-01-01T00:00:00.000Z' },
    { applier: 'b', scheduledDate: '2026-01-02T00:00:00.000Z' },
  ];
  assert.equal(resolveJobStatusState(rows, 'a'), 'applied');
  assert.equal(resolveJobStatusState(rows, 'b'), 'scheduled');
  assert.equal(resolveJobStatusState(rows, 'c'), 'posted');
});

test('duplicate rows merge and the newest scheduled/declined transition wins', () => {
  const merged = mergeJobStatusRows([
    { applier: 'a', appliedDate: '2026-01-01T00:00:00.000Z', scheduledDate: '2026-01-02T00:00:00.000Z' },
    { applier: 'a', declinedDate: '2026-01-03T00:00:00.000Z' },
  ], 'a');
  assert.equal(resolveJobStatusState(merged), 'declined');
  assert.equal(merged.appliedDate, '2026-01-01T00:00:00.000Z');
  assert.equal(merged.scheduledDate, undefined);
  assert.equal(merged.declinedDate, '2026-01-03T00:00:00.000Z');
});

test('duplicate rows retain the original applied and bid-ready timestamps', () => {
  const merged = mergeJobStatusRows([
    { applier: 'a', appliedDate: '2026-01-03T00:00:00.000Z', bidReadyDate: '2026-01-04T00:00:00.000Z' },
    { applier: 'a', appliedDate: '2026-01-01T00:00:00.000Z', bidReadyDate: '2026-01-02T00:00:00.000Z' },
  ], 'a');
  assert.equal(merged.appliedDate, '2026-01-01T00:00:00.000Z');
  assert.equal(merged.bidReadyDate, '2026-01-02T00:00:00.000Z');
});

test('pipeline status takes precedence over retained bid history', () => {
  const row = { appliedDate: 'applied', bidReadyDate: 'ready', bidCompletedDate: 'completed' };
  assert.equal(resolveJobStatusState(row), 'applied');
  assert.deepEqual(jobStatusContribution(row), {
    any: 1,
    rawApplied: 1,
    applied: 1,
    scheduled: 0,
    declined: 0,
    'bid-ready': 0,
    'bid-completed': 0,
  });
});
