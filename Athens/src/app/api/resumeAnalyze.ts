import { API_BASE } from "@/lib/api-base";
import { retryTransient } from "@/lib/transient-retry";

export type ResumeAnalyzeItemProgress = {
  status: "queued" | "running" | "completed" | "failed" | "skipped";
  error?: string;
  skillCount?: number;
  alreadyAnalyzed?: boolean;
};

export type ResumeAnalyzeSession = {
  success?: boolean;
  running: boolean;
  status: "idle" | "running" | "stopping" | "completed" | "cancelled" | "failed";
  sessionId?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  total?: number;
  processed?: number;
  completed?: number;
  failed?: number;
  skipped?: number;
  error?: string | null;
  concurrency?: number;
  batchSize?: number;
  items?: Record<string, ResumeAnalyzeItemProgress>;
  progress?: {
    total?: number;
    completed?: number;
    failed?: number;
    skipped?: number;
    items?: Record<string, ResumeAnalyzeItemProgress>;
  };
};

type JsonError = { error?: string; message?: string };

async function parseJson<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as T & JsonError;
  if (!response.ok) {
    throw new Error(data.error || data.message || `Request failed (${response.status})`);
  }
  return data;
}

export async function fetchResumeAnalyzeStatus(): Promise<ResumeAnalyzeSession> {
  return retryTransient(async () => {
    const response = await fetch(`${API_BASE}/resumes/analyze/status`);
    return parseJson<ResumeAnalyzeSession>(response);
  });
}

export async function startResumeAnalyze(input: {
  applierName: string;
  profileId?: string;
  resumeIds: string[];
  force?: boolean;
}): Promise<ResumeAnalyzeSession> {
  const response = await fetch(`${API_BASE}/resumes/analyze/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      applierName: input.applierName,
      ownerName: input.applierName,
      ...(input.profileId ? { profileId: input.profileId } : {}),
      resumeIds: input.resumeIds,
      force: Boolean(input.force),
    }),
  });
  return parseJson<ResumeAnalyzeSession>(response);
}

export async function stopResumeAnalyze(): Promise<ResumeAnalyzeSession> {
  const response = await fetch(`${API_BASE}/resumes/analyze/stop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  return parseJson<ResumeAnalyzeSession>(response);
}

/** Poll until the in-process session is no longer running. */
export async function waitForResumeAnalyze(options?: {
  intervalMs?: number;
  onProgress?: (session: ResumeAnalyzeSession) => void;
  signal?: AbortSignal;
}): Promise<ResumeAnalyzeSession> {
  const intervalMs = options?.intervalMs ?? 1200;
  let last = await fetchResumeAnalyzeStatus();
  options?.onProgress?.(last);
  while (last.running) {
    if (options?.signal?.aborted) {
      throw options.signal.reason instanceof Error
        ? options.signal.reason
        : Object.assign(new Error("Resume analysis wait aborted"), { name: "AbortError" });
    }
    await new Promise((r) => setTimeout(r, intervalMs));
    last = await fetchResumeAnalyzeStatus();
    options?.onProgress?.(last);
  }
  return last;
}
