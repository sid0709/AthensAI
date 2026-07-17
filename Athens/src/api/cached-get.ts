import { API_BASE } from "@/lib/api-base";

type CacheEntry = {
  data: unknown;
  fetchedAt: number;
  inflight: Promise<unknown> | null;
};

const cache = new Map<string, CacheEntry>();
const TTL_MS = 60_000;

export function invalidateCachedGet(path: string) {
  cache.delete(path);
}

export async function cachedGet(path: string): Promise<unknown> {
  const entry = cache.get(path);
  if (entry && entry.data !== undefined && Date.now() - entry.fetchedAt < TTL_MS) {
    return entry.data;
  }
  if (entry?.inflight) return entry.inflight;

  const url = `${API_BASE.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
  const inflight = fetch(url)
    .then(async (res) => {
      if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
      const data = (await res.json()) as unknown;
      cache.set(path, { data, fetchedAt: Date.now(), inflight: null });
      return data;
    })
    .catch((err) => {
      cache.delete(path);
      throw err;
    });
  cache.set(path, { data: entry?.data, fetchedAt: entry?.fetchedAt ?? 0, inflight });
  return inflight;
}
