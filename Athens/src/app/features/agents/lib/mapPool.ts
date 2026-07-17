/**
 * Run `fn` over `items` with at most `concurrency` in flight.
 * Results preserve input order.
 */
export async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const list = Array.isArray(items) ? items : [];
  const max = Math.max(1, concurrency | 0);
  const results = new Array<R>(list.length);
  let next = 0;

  async function worker() {
    while (true) {
      const i = next++;
      if (i >= list.length) return;
      results[i] = await fn(list[i], i);
    }
  }

  const workers = Array.from({ length: Math.min(max, list.length || 1) }, () => worker());
  await Promise.all(workers);
  return results;
}
