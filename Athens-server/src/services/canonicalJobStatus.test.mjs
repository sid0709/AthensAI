import test from 'node:test';
import assert from 'node:assert/strict';
import { DocumentId } from '@nextoffer/shared/document-id';
import {
  createProfileIdResolver,
  normalizeCanonicalJobStatuses,
} from './canonicalJobStatus.js';

test('canonical migration normalizes IDs and merges duplicate profile rows', () => {
  const resolve = createProfileIdResolver([{ _id: 'profile-1', name: 'Owner One' }]);
  const result = normalizeCanonicalJobStatuses([
    { applier: 'Owner One', appliedDate: new Date('2026-01-02T00:00:00Z') },
    { applier: 'profile-1', appliedDate: '2026-01-01', scheduledDate: '2026-01-03' },
  ], resolve);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.statuses, [{
    applier: 'profile-1',
    appliedDate: '2026-01-01T00:00:00.000Z',
    scheduledDate: '2026-01-03T00:00:00.000Z',
  }]);
});

test('newest scheduled/declined transition wins and missing prerequisite dates are restored', () => {
  const resolve = (value) => String(value);
  const result = normalizeCanonicalJobStatuses([
    { applier: 'p', scheduledDate: '2026-01-02' },
    { applier: 'p', declinedDate: '2026-01-03' },
    { applier: 'b', bidCompletedDate: '2026-01-04' },
  ], resolve);
  assert.equal(result.statuses[1].declinedDate, '2026-01-03T00:00:00.000Z');
  assert.equal(result.statuses[1].scheduledDate, undefined);
  assert.equal(result.statuses[1].appliedDate, result.statuses[1].declinedDate);
  assert.equal(result.statuses[0].bidReadyDate, result.statuses[0].bidCompletedDate);
});

test('invalid dates and unresolved users fail closed', () => {
  const unresolved = normalizeCanonicalJobStatuses([
    { applier: 'missing', appliedDate: 'not-a-date' },
  ], () => null);
  assert.equal(unresolved.statuses.length, 0);
  assert.equal(unresolved.issues[0].reason, 'unknown profile reference');

  const invalidDate = normalizeCanonicalJobStatuses([
    { applier: 'profile-1', appliedDate: 'not-a-date' },
  ], () => 'profile-1');
  assert.equal(invalidDate.statuses.length, 0);
  assert.equal(invalidDate.issues[0].reason, 'invalid timestamp');
});

test('DocumentId references become stable strings and normalization is idempotent', () => {
  const profileId = new DocumentId();
  const resolve = createProfileIdResolver([{ _id: profileId, name: 'Owner' }]);
  const first = normalizeCanonicalJobStatuses([
    { applier: profileId, appliedDate: '2026-01-01' },
  ], resolve);
  const second = normalizeCanonicalJobStatuses(first.statuses, resolve);
  assert.equal(first.statuses[0].applier, profileId.toHexString());
  assert.deepEqual(second, first);
});
