import test from 'node:test';
import assert from 'node:assert/strict';
import { syncJobTitleReviewUpdates } from './titleReviewIndexSync.js';

test('sync writes only supported effective labels and bumps the catalog revision', async () => {
  let received = null;
  let bumps = 0;
  const result = await syncJobTitleReviewUpdates({
    one: 'APPROVED',
    two: 'REVIEW_REQUIRED',
    three: 'UNKNOWN',
  }, {
    updateIndexed: async (updates) => { received = updates; return updates.length; },
    bumpRevision: async () => { bumps += 1; return '7'; },
  });
  assert.deepEqual(received, [
    { jobId: 'one', label: 'APPROVED' },
    { jobId: 'two', label: 'REVIEW_REQUIRED' },
  ]);
  assert.deepEqual(result, { updated: 2, revision: '7' });
  assert.equal(bumps, 1);
});

