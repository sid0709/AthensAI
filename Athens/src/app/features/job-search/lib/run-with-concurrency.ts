export async function runWithConcurrency<T, R>(
  items: T[],
  worker: (item: T) => Promise<R>,
  concurrency = 6,
): Promise<R[]> {
  const results: R[] = [];
  const width = Math.max(1, Math.floor(concurrency));
  for (let offset = 0; offset < items.length; offset += width) {
    results.push(...(await Promise.all(items.slice(offset, offset + width).map(worker))));
  }
  return results;
}
