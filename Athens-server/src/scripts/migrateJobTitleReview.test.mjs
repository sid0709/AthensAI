import test from 'node:test';
import assert from 'node:assert/strict';
import { JOB_MARKET_MODEL_VERSION } from '../config/jobMarketSchema.js';
import {
  backfillPendingTitleReviewState,
  cleanupLegacyTitleReviewFields,
  legacyTitleReviewCleanupFilter,
  legacyTitleReviewCleanupUpdate,
  pendingTitleReviewBackfillFilter,
  rebuildTitleReviewRankingPayloads,
} from './migrateJobTitleReview.js';

test('pending-state backfill targets only title reviews without a state', () => {
  assert.deepEqual(pendingTitleReviewBackfillFilter(), {
    'titleReview.processingState': { $exists: false },
  });
});

test('pending-state backfill uses guarded bounded writes', async () => {
  const operations = [];
  const collection = {
    findPaged: async function* () {
      yield { _id: 'one' };
      yield { _id: 'two' };
      yield { _id: 'three' };
    },
    bulkWrite: async (batch) => {
      operations.push(...batch);
      return { modifiedCount: batch.length };
    },
  };
  const result = await backfillPendingTitleReviewState(collection, { batchSize: 2 });
  assert.deepEqual(result, { total: 3, updated: 3, dryRun: false });
  assert.equal(operations.length, 3);
  assert.ok(operations.every(({ updateOne }) =>
    updateOne.filter['titleReview.processingState']?.$exists === false &&
    updateOne.update.$set['titleReview.processingState'] === 'pending'));
});

test('title-review migration permanently unsets every legacy field and stamps the schema', () => {
  assert.deepEqual(legacyTitleReviewCleanupUpdate(), {
    $unset: {
      titleScanned: '',
      titleScannedAt: '',
      titleScanStatus: '',
      titleScanError: '',
    },
    $set: { modelVersion: JOB_MARKET_MODEL_VERSION },
  });
});

test('title-review migration filter is idempotent and includes schema stamping', () => {
  const filter = legacyTitleReviewCleanupFilter();
  assert.ok(filter.$or.some((clause) => clause.titleScanned?.$exists === true));
  assert.ok(filter.$or.some((clause) => clause.modelVersion?.$ne === JOB_MARKET_MODEL_VERSION));
});

test('title-review migration dry run reports count without writing', async () => {
  let writes = 0;
  const result = await cleanupLegacyTitleReviewFields({
    countDocuments: async () => 42,
    bulkWrite: async () => { writes += 1; },
  }, { dryRun: true });
  assert.deepEqual(result, { total: 42, updated: 0, dryRun: true });
  assert.equal(writes, 0);
});

test('title-review migration cleanup uses bounded batches', async () => {
  const batchSizes = [];
  const collection = {
    countDocuments: async () => 3,
    findPaged: async function* () {
      yield { _id: 'one' };
      yield { _id: 'two' };
      yield { _id: 'three' };
    },
    bulkWrite: async (operations) => {
      batchSizes.push(operations.length);
      return { modifiedCount: operations.length };
    },
  };
  const result = await cleanupLegacyTitleReviewFields(collection, { batchSize: 2 });
  assert.deepEqual(batchSizes, [2, 1]);
  assert.deepEqual(result, { total: 3, updated: 3, dryRun: false });
});

test('ranking payload rebuild sends every market job in bounded batches', async () => {
  const batches = [];
  const collection = {
    findPaged: async function* () {
      yield { _id: 'one' };
      yield { _id: 'two' };
      yield { _id: 'three' };
    },
  };
  const result = await rebuildTitleReviewRankingPayloads(collection, {
    batchSize: 2,
    indexBatch: async (jobs, options) => {
      batches.push({ ids: jobs.map((job) => job._id), options });
      return { indexed: jobs.length };
    },
  });
  assert.deepEqual(batches.map((batch) => batch.ids), [['one', 'two'], ['three']]);
  assert.ok(batches.every((batch) => batch.options.catalog === 'market' && batch.options.wait === true));
  assert.deepEqual(result, { indexed: 3 });
});
