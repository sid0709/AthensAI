type RetryableError = Error & { status?: number };

// Vite reports a refused dev-proxy connection as 500; all callers of this
// helper are idempotent reads, so one short retry window is safe.
const TRANSIENT_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const DEFAULT_DELAYS_MS = [300, 600, 1_200, 2_400];

function statusFromError(error: unknown): number | null {
  const direct = Number((error as RetryableError | null)?.status);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const match = String((error as Error | null)?.message || "").match(/\((\d{3})\)/);
  return match ? Number(match[1]) : null;
}

export function isTransientRequestError(error: unknown): boolean {
  if ((error as Error | null)?.name === "AbortError") return false;
  const status = statusFromError(error);
  if (status != null) return TRANSIENT_HTTP_STATUSES.has(status);
  if (error instanceof TypeError) return true;
  return /failed to fetch|networkerror|load failed|socket hang up|econnrefused/i.test(
    String((error as Error | null)?.message || ""),
  );
}

function abortError() {
  return new DOMException("The request was aborted", "AbortError");
}

function waitForRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timeout);
      reject(abortError());
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function retryTransient<T>(
  operation: () => Promise<T>,
  {
    signal,
    delaysMs = DEFAULT_DELAYS_MS,
  }: { signal?: AbortSignal; delaysMs?: number[] } = {},
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= delaysMs.length; attempt += 1) {
    if (signal?.aborted) throw abortError();
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientRequestError(error) || attempt === delaysMs.length) throw error;
      await waitForRetry(delaysMs[attempt], signal);
    }
  }
  throw lastError;
}
