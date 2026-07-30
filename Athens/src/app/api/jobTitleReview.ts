import { API_BASE } from "@/lib/api-base";
import { retryTransient } from "@/lib/transient-retry";

export type TitleReviewLabel = "APPROVED" | "REVIEW_REQUIRED";
export type TitleReviewSession = {
  running: boolean;
  status: "idle" | "running" | "completed" | "cancelled" | "failed";
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

type JsonError = { error?: string };

async function parseJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({})) as T & JsonError;
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
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

export async function fetchTitleReviewJobs(options: {
  applierName: string;
  tab: "unreviewed" | "review_required" | "failed";
  page: number;
  limit: number;
  q?: string;
  sort?: "confidence_desc" | "newest" | "oldest";
}): Promise<{
  data: TitleReviewJob[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}> {
  const params = new URLSearchParams({
    applierName: options.applierName,
    tab: options.tab,
    page: String(options.page),
    limit: String(options.limit),
    q: options.q || "",
    sort: options.sort || "newest",
  });
  const response = await fetch(`${API_BASE}/jobs/title-review?${params}`);
  return parseJson(response);
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
  }>(response);
}

export const approveTitleReviewJobs = (applierName: string, ids: string[]) =>
  mutateTitleReviewJobs("approve", applierName, ids);

export const removeTitleReviewJobs = (applierName: string, ids: string[]) =>
  mutateTitleReviewJobs("remove", applierName, ids);
