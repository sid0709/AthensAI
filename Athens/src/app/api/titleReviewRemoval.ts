export type TitleReviewRemovalProgress = {
  total: number;
  processed: number;
  removed: number;
  deleted: number;
  alreadyAbsent: number;
  failed: number;
  activeBatches: number;
  completedBatches: number;
  batchCount: number;
};

export type TitleReviewRemovalResult = {
  removedCount: number;
  removedIds: string[];
  deletedCount: number;
  deletedIds: string[];
  alreadyAbsentCount: number;
  failedIds: string[];
  errors: string[];
};

type RemovalBatchResult = {
  removedCount?: number;
  removedIds?: string[];
  deletedCount?: number;
  deletedIds?: string[];
  alreadyAbsentCount?: number;
};

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
  let removed = 0;
  let deleted = 0;
  let alreadyAbsent = 0;
  let failed = 0;
  let activeBatches = 0;
  let completedBatches = 0;
  const removedIds: string[] = [];
  const deletedIds: string[] = [];
  const failedIds: string[] = [];
  const errors: string[] = [];

  const publish = () => onProgress?.({
    total: uniqueIds.length,
    processed,
    removed,
    deleted,
    alreadyAbsent,
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
        const resultDeletedIds = Array.isArray(result.deletedIds) ? result.deletedIds.map(String) : [];
        const resultRemovedIds = Array.isArray(result.removedIds)
          ? result.removedIds.map(String)
          : resultDeletedIds;
        const resultDeleted = Math.min(
          batch.length,
          Math.max(0, Number(result.deletedCount ?? resultDeletedIds.length) || 0),
        );
        const resultRemoved = Math.min(
          batch.length,
          Math.max(0, Number(result.removedCount ?? resultDeleted) || 0),
        );
        const resultAlreadyAbsent = Math.min(
          resultRemoved,
          Math.max(0, Number(result.alreadyAbsentCount ?? resultRemoved - resultDeleted) || 0),
        );
        removedIds.push(...resultRemovedIds);
        deletedIds.push(...resultDeletedIds);
        removed += resultRemoved;
        deleted += resultDeleted;
        alreadyAbsent += resultAlreadyAbsent;
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
    removedCount: removed,
    removedIds: [...new Set(removedIds)],
    deletedCount: deleted,
    deletedIds: [...new Set(deletedIds)],
    alreadyAbsentCount: alreadyAbsent,
    failedIds,
    errors: [...new Set(errors)],
  };
}
