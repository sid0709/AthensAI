import { API_BASE } from "@/lib/api-base";
import { retryTransient } from "@/lib/transient-retry";

/** AI Analyze session (legacy type name kept for callers). */
export type SkillExtractSession = {
  running: boolean;
  status: "idle" | "queued" | "running" | "stopping" | "completed" | "cancelled" | "failed";
  sessionId?: string | null;
  pending?: number | null;
  pendingKnown?: boolean;
  total?: number | null;
  processed?: number;
  extracted?: number;
  failed?: number;
  promoted?: number;
  retried?: number;
  cancelled?: number;
  remaining?: number | null;
  phase?: "queued" | "starting" | "recovering" | "claiming" | "extracting" | "analyzing" | "stopping" | "completed" | "cancelled";
  inflight?: number;
  lastProgressAt?: string | null;
  lastJob?: { id: string; title: string; skills?: number } | null;
  queuedAt?: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  error?: string | null;
  concurrency?: number;
  batchSize?: number;
  jobsPerWave?: number;
  message?: string;
};

type StatusResponse = { success?: boolean; error?: string; message?: string } & SkillExtractSession;

type StartResponse = SkillExtractSession & {
  success?: boolean;
  error?: string;
  message?: string;
  started?: boolean;
};

async function parseJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({})) as T & { error?: string; message?: string };
  if (!res.ok) {
    const error = new Error(data.error || data.message || `Request failed (${res.status})`) as Error & {
      status?: number;
    };
    error.status = res.status;
    throw error;
  }
  return data;
}

export async function fetchSkillExtractStatus(applierName?: string): Promise<SkillExtractSession> {
  const qs = applierName
    ? `?applierName=${encodeURIComponent(applierName)}`
    : "";
  return retryTransient(async () => {
    const res = await fetch(`${API_BASE}/jobs/ai-analyze/status${qs}`);
    return parseJson<StatusResponse>(res);
  });
}

export async function startSkillExtract(
  applierName?: string,
  profileId?: string,
): Promise<StartResponse> {
  const res = await fetch(`${API_BASE}/jobs/ai-analyze/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...(applierName ? { applierName } : {}),
      ...(profileId ? { profileId } : {}),
    }),
  });
  const data = await parseJson<StartResponse>(res);
  return { ...data, started: Boolean(data.running) };
}

export async function stopSkillExtract(
  applierName?: string,
  profileId?: string,
): Promise<SkillExtractSession & { stopped?: boolean; message?: string }> {
  const res = await fetch(`${API_BASE}/jobs/ai-analyze/stop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...(applierName ? { applierName } : {}),
      ...(profileId ? { profileId } : {}),
    }),
  });
  const data = await parseJson<SkillExtractSession & { message?: string }>(res);
  return { ...data, stopped: !data.running };
}
