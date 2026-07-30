import test from "node:test";
import assert from "node:assert/strict";
import { runBatchedTitleReviewRemoval, type TitleReviewRemovalProgress } from "./titleReviewRemoval";

test("large title-review removals are bounded and report live progress", async () => {
  const ids = Array.from({ length: 250 }, (_, index) => `job-${index}`);
  const batchSizes: number[] = [];
  const progress: TitleReviewRemovalProgress[] = [];
  let active = 0;
  let peak = 0;

  const result = await runBatchedTitleReviewRemoval({
    ids: [...ids, "job-0"],
    batchSize: 100,
    concurrency: 3,
    onProgress: (next) => progress.push({ ...next }),
    removeBatch: async (batch) => {
      batchSizes.push(batch.length);
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return { deletedCount: batch.length, deletedIds: batch };
    },
  });

  assert.deepEqual(batchSizes.sort((left, right) => right - left), [100, 100, 50]);
  assert.equal(peak, 3);
  assert.equal(result.deletedCount, 250);
  assert.equal(result.failedIds.length, 0);
  assert.deepEqual(progress.at(-1), {
    total: 250,
    processed: 250,
    deleted: 250,
    failed: 0,
    activeBatches: 0,
    completedBatches: 3,
    batchCount: 3,
  });
});

test("a failed deletion batch does not stop successful siblings", async () => {
  const ids = Array.from({ length: 150 }, (_, index) => `job-${index}`);
  let finalProgress: TitleReviewRemovalProgress | undefined;

  const result = await runBatchedTitleReviewRemoval({
    ids,
    batchSize: 100,
    concurrency: 2,
    onProgress: (next) => { finalProgress = { ...next }; },
    removeBatch: async (batch) => {
      if (batch.includes("job-0")) throw new Error("temporary deletion failure");
      return { deletedCount: batch.length, deletedIds: batch };
    },
  });

  assert.equal(result.deletedCount, 50);
  assert.equal(result.failedIds.length, 100);
  assert.deepEqual(result.errors, ["temporary deletion failure"]);
  assert.equal(finalProgress?.processed, 150);
  assert.equal(finalProgress?.failed, 100);
  assert.equal(finalProgress?.activeBatches, 0);
});
