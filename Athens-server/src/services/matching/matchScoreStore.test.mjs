import test from 'node:test';
import assert from 'node:assert/strict';
import { deleteScoreRowsForJobIds } from './matchScoreStore.js';

test('score cleanup batches Firestore in-queries and caps concurrency', async () => {
  const jobIds = Array.from({ length: 95 }, (_, index) => index.toString(16).padStart(24, '0'));
  const batchSizes = [];
  let active = 0;
  let peak = 0;
  const collection = {
    async deleteMany(filter) {
      const ids = filter.jobId.$in;
      batchSizes.push(ids.length);
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return { deletedCount: ids.length * 2 };
    },
  };

  const result = await deleteScoreRowsForJobIds({ collection, jobIds, concurrency: 3 });

  assert.deepEqual(batchSizes.sort((left, right) => right - left), [30, 30, 30, 5]);
  assert.equal(peak, 3);
  assert.equal(result.deleted, 190);
});
