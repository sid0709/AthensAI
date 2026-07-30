export type TitleReviewRemovalProgress = {
  total: number;
  processed: number;
  deleted: number;
  failed: number;
  activeBatches: number;
  completedBatches: number;
  batchCount: number;
};

export type TitleReviewRemovalResult = {
  deletedCount: number;
  deletedIds: string[];
  failedIds: string[];
  errors: string[];
};

type RemovalBatchResult = { deletedCount?: number; deletedIds?: string[] };

/** Run a large deletion in bounded batches while reporting settled-item progress. */
export async function runBatchedTitleReviewRemoval({
  ids,
  removeBatch,
  onProgress,
  batchSize = 100,
  concurrency = 3,
}: {
  ids: string[];
  removeBatch: (ids: string[]) => Promise<RemovalBatchResult>;
  onProgress?: (progress: TitleReviewRemovalProgress) => void;
  batchSize?: number;
  concurrency?: number;
}): Promise<TitleReviewRemovalResult> {
  const uniqueIds = [...new Set(ids.map((id) => String(id || "").trim()).filter(Boolean))];
  const safeBatchSize = Math.max(1, Math.floor(batchSize));
  const batches: string[][] = [];
  for (let offset = 0; offset < uniqueIds.length; offset += safeBatchSize) {
    batches.push(uniqueIds.slice(offset, offset + safeBatchSize));
  }

  let nextBatch = 0;
  let processed = 0;
  let deleted = 0;
  let failed = 0;
  let activeBatches = 0;
  let completedBatches = 0;
  const deletedIds: string[] = [];
  const failedIds: string[] = [];
  const errors: string[] = [];

  const publish = () => onProgress?.({
    total: uniqueIds.length,
    processed,
    deleted,
    failed,
    activeBatches,
    completedBatches,
    batchCount: batches.length,
  });

  publish();

  async function worker() {
    while (true) {
      const batchIndex = nextBatch++;
      if (batchIndex >= batches.length) return;
      const batch = batches[batchIndex];
      activeBatches += 1;
      publish();
      try {
        const result = await removeBatch(batch);
        const resultIds = Array.isArray(result.deletedIds) ? result.deletedIds.map(String) : [];
        deletedIds.push(...resultIds);
        deleted += Math.min(batch.length, Math.max(0, Number(result.deletedCount ?? resultIds.length) || 0));
      } catch (error) {
        failed += batch.length;
        failedIds.push(...batch);
        errors.push(error instanceof Error ? error.message : "Failed to remove a title-review batch");
      } finally {
        activeBatches -= 1;
        completedBatches += 1;
        processed += batch.length;
        publish();
      }
    }
  }

  const workerCount = Math.min(Math.max(1, Math.floor(concurrency)), batches.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return {
    deletedCount: deleted,
    deletedIds: [...new Set(deletedIds)],
    failedIds,
    errors: [...new Set(errors)],
  };
}
