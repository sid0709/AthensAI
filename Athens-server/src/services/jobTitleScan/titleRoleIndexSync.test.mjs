import test from 'node:test';
import assert from 'node:assert/strict';
import {
  reconcileJobTitleRoleIndex,
  syncJobTitleRoleUpdates,
} from './titleRoleIndexSync.js';

test('newly scanned title roles are patched into the ranking index', async () => {
  const patched = [];
  let revisions = 0;
  const result = await syncJobTitleRoleUpdates({
    'job-1': 'Software Engineer',
    'job-2': 'DevOps',
    invalid: 'Not a role',
  }, {
    updateIndexed: async (updates) => {
      patched.push(...updates);
      return updates.length;
    },
    bumpRevision: async () => String(++revisions),
  });

  assert.deepEqual(patched, [
    { jobId: 'job-1', role: 'Software Engineer' },
    { jobId: 'job-2', role: 'DevOps' },
  ]);
  assert.deepEqual(result, { updated: 2, revision: '1' });
  assert.equal(revisions, 1);
});

test('startup reconciliation repairs a ranking index with missing title roles', async () => {
  const jobs = [
    { _id: 'job-1', titleScanned: 'Software Engineer' },
    { _id: 'job-2', title: 'Senior Data Platform Engineer' },
  ];
  const patched = [];
  let revisions = 0;
  const collection = {
    countDocuments: async () => jobs.length,
    async *findPaged() {
      yield* jobs;
    },
  };

  const result = await reconcileJobTitleRoleIndex({
    collection,
    countIndexed: async () => 0,
    updateIndexed: async (updates) => {
      patched.push(...updates);
      return updates.length;
    },
    bumpRevision: async () => String(++revisions),
  });

  assert.equal(result.updated, 2);
  assert.equal(result.skipped, false);
  assert.deepEqual(patched, [
    { jobId: 'job-1', role: 'Software Engineer' },
    { jobId: 'job-2', role: 'Data Engineer' },
  ]);
  assert.equal(revisions, 1);
});

test('startup reconciliation skips the scan when indexed roles are current', async () => {
  let scanned = false;
  const collection = {
    countDocuments: async () => 2,
    async *findPaged() {
      scanned = true;
    },
  };
  const result = await reconcileJobTitleRoleIndex({
    collection,
    countIndexed: async () => 2,
  });
  assert.equal(result.skipped, true);
  assert.equal(scanned, false);
});
