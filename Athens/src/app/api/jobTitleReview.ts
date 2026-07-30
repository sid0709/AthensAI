import { API_BASE } from "@/lib/api-base";
import { retryTransient } from "@/lib/transient-retry";
import type { BackgroundTask } from "./backgroundTasks";
import {
  runBatchedTitleReviewRemoval,
  type TitleReviewRemovalProgress,
  type TitleReviewRemovalResult,
} from "./titleReviewRemoval";

export type { TitleReviewRemovalProgress, TitleReviewRemovalResult } from "./titleReviewRemoval";

export type TitleReviewLabel = "APPROVED" | "REVIEW_REQUIRED";
export type TitleReviewSession = {
  running: boolean;
  status: "idle" | "running" | "stopping" | "completed" | "cancelled" | "failed";
  phase?: "preparing" | "processing" | "finalizing" | null;
  sessionId?: string;
  total?: number;
  processed?: number;
  approved?: number;
  reviewRequired?: number;
  failed?: number;
  remaining?: number;
  pending?: number | null;
  unreviewedCount?: number | null;
  reviewRequiredCount?: number | null;
  failedCount?: number | null;
  concurrency?: number;
  batchSize?: number;
  startedAt?: string;
  finishedAt?: string | null;
  error?: string | null;
};

export type TitleReviewJob = {
  id: string;
  title: string;
  company: string;
  source: string;
  postedAt?: string | null;
  applyUrl?: string;
  titleReview: {
    processingState: "pending" | "scanning" | "completed" | "failed";
    label?: TitleReviewLabel;
    aiLabel?: TitleReviewLabel;
    originalTitle?: string;
    confidence?: number;
    reason?: string;
    decisionSource?: "ai" | "manual";
    classifiedAt?: string;
    error?: { code?: string; message?: string; failedAt?: string };
  } | null;
};

export type TitleReviewListMeta = {
  cacheSource: "memory" | "redis" | "firestore";
  revision: string;
  snapshotRevision?: string;
  stale: boolean;
  builtAt?: string | null;
  serverDurationMs: number;
  cacheLookupMs?: number;
  firestoreMs?: number;
  serializationMs?: number;
  returnedRows?: number;
};

export type TitleReviewListResponse = {
  success: boolean;
  data: TitleReviewJob[];
  counts?: Pick<TitleReviewSession, "pending" | "unreviewedCount" | "reviewRequiredCount" | "failedCount"> | null;
  pagination: { page: number; limit: number; total: number; totalPages: number };
  meta: TitleReviewListMeta;
};

export type TitleReviewBootstrapResponse = TitleReviewListResponse & {
  session: TitleReviewSession;
};

export type TitleReviewListOptions = {
  applierName: string;
  tab: "unreviewed" | "review_required" | "failed";
  page: number;
  limit: number;
  q?: string;
  sort?: "confidence_desc" | "newest" | "oldest";
};

/** Exact number of jobs that have not completed title classification yet. */
export function titleReviewToolbarCount(
  session: Pick<TitleReviewSession, "unreviewedCount" | "pending">,
) {
  return session.unreviewedCount ?? session.pending ?? null;
}

type JsonError = { error?: string; code?: string; retryAfter?: number };

async function parseJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({})) as T & JsonError;
  if (!response.ok) {
    const error = new Error(data.error || `Request failed (${response.status})`) as Error & {
      code?: string;
      retryAfter?: number;
    };
    error.code = data.code;
    error.retryAfter = data.retryAfter;
    throw error;
  }
  return data;
}

export async function fetchTitleReviewStatus(applierName: string): Promise<TitleReviewSession> {
  return retryTransient(async () => {
    const response = await fetch(
      `${API_BASE}/jobs/title-review/status?applierName=${encodeURIComponent(applierName)}`,
    );
    return parseJson<TitleReviewSession>(response);
  });
}

export async function startTitleReview(applierName: string) {
  const response = await fetch(`${API_BASE}/jobs/title-review/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ applierName }),
  });
  return parseJson<{ success: boolean; started: boolean; pending?: number; message?: string }>(response);
}

export async function stopTitleReview(applierName: string) {
  const response = await fetch(`${API_BASE}/jobs/title-review/stop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ applierName }),
  });
  return parseJson<{ success: boolean; stopped: boolean; message?: string }>(response);
}

function titleReviewParams(options: TitleReviewListOptions) {
  const params = new URLSearchParams({
    applierName: options.applierName,
    tab: options.tab,
    page: String(options.page),
    limit: String(options.limit),
    q: options.q || "",
    sort: options.sort || "newest",
  });
  return params;
}

export function titleReviewListCacheKey(options: TitleReviewListOptions) {
  return titleReviewParams(options).toString();
}

const listCache = new Map<string, TitleReviewListResponse>();
const prefetches = new Map<string, Promise<TitleReviewListResponse>>();

export function getCachedTitleReviewJobs(options: TitleReviewListOptions) {
  return listCache.get(titleReviewListCacheKey(options)) || null;
}

export function cacheTitleReviewJobs(options: TitleReviewListOptions, response: TitleReviewListResponse) {
  const key = titleReviewListCacheKey(options);
  listCache.set(key, response);
  if (listCache.size > 60) listCache.delete(listCache.keys().next().value!);
}

export function invalidateTitleReviewListCache() {
  listCache.clear();
}

export async function fetchTitleReviewJobs(
  options: TitleReviewListOptions,
  { signal }: { signal?: AbortSignal } = {},
): Promise<TitleReviewListResponse> {
  const response = await fetch(`${API_BASE}/jobs/title-review?${titleReviewParams(options)}`, { signal });
  return parseJson<TitleReviewListResponse>(response);
}

export async function fetchTitleReviewBootstrap(
  options: TitleReviewListOptions,
  { signal }: { signal?: AbortSignal } = {},
): Promise<TitleReviewBootstrapResponse> {
  const response = await fetch(`${API_BASE}/jobs/title-review/bootstrap?${titleReviewParams(options)}`, { signal });
  return parseJson<TitleReviewBootstrapResponse>(response);
}

export function prefetchTitleReviewJobs(options: TitleReviewListOptions) {
  const key = titleReviewListCacheKey(options);
  const cached = listCache.get(key);
  if (cached) return Promise.resolve(cached);
  const existing = prefetches.get(key);
  if (existing) return existing;
  const promise = fetchTitleReviewJobs(options)
    .then((response) => {
      cacheTitleReviewJobs(options, response);
      return response;
    })
    .finally(() => prefetches.delete(key));
  prefetches.set(key, promise);
  return promise;
}

async function mutateTitleReviewJobs(
  action: "approve" | "remove",
  applierName: string,
  ids: string[],
) {
  const response = await fetch(`${API_BASE}/jobs/title-review/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ applierName, ids }),
  });
  return parseJson<{
    success: boolean;
    approvedCount?: number;
    approvedIds?: string[];
    deletedCount?: number;
    deletedIds?: string[];
    removedCount?: number;
    removedIds?: string[];
    alreadyAbsentCount?: number;
		task?: BackgroundTask;
  }>(response);
}

export const approveTitleReviewJobs = (applierName: string, ids: string[]) =>
  mutateTitleReviewJobs("approve", applierName, ids);

export const removeTitleReviewJobs = (applierName: string, ids: string[]) =>
  mutateTitleReviewJobs("remove", applierName, ids);

const TITLE_REVIEW_REMOVAL_BATCH_SIZE = 100;
const TITLE_REVIEW_REMOVAL_CONCURRENCY = 3;

/** Delete large selections in bounded parallel batches so callers can render live progress. */
export async function removeTitleReviewJobsWithProgress(
  applierName: string,
  ids: string[],
  onProgress?: (progress: TitleReviewRemovalProgress) => void,
): Promise<TitleReviewRemovalResult> {
  return runBatchedTitleReviewRemoval({
    ids,
    removeBatch: (batch) => removeTitleReviewJobs(applierName, batch),
    onProgress,
    batchSize: TITLE_REVIEW_REMOVAL_BATCH_SIZE,
    concurrency: TITLE_REVIEW_REMOVAL_CONCURRENCY,
  });
}
