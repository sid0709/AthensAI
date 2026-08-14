/** Sliding pool: start the next item as soon as a slot frees. Unlike wave batches, a slow item does not idle the other slots. */
export async function runWithSlidingPool<T>(
  items: T[],
  worker: (item: T, index: number) => Promise<void>,
  concurrency: number,
  shouldStart?: () => boolean,
): Promise<void> {
  if (!items.length) return;
  const width = Math.max(1, Math.min(Math.floor(concurrency), items.length));
  let next = 0;

  async function runSlot(): Promise<void> {
    while (true) {
      if (shouldStart && !shouldStart()) return;
      const index = next;
      next += 1;
      if (index >= items.length) return;
      await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: width }, () => runSlot()));
}
