import { API_BASE } from "@/lib/api-base";
import { retryTransient } from "@/lib/transient-retry";

export type SkillExtractSession = {
  running: boolean;
  status: "idle" | "running" | "stopping" | "completed" | "cancelled" | "failed";
  sessionId?: string;
  pending?: number | null;
  pendingKnown?: boolean;
  total?: number | null;
  processed?: number;
  extracted?: number;
  failed?: number;
  retried?: number;
  cancelled?: number;
  remaining?: number | null;
  phase?: "starting" | "recovering" | "claiming" | "extracting" | "stopping" | "completed" | "cancelled";
  inflight?: number;
  lastProgressAt?: string | null;
  lastJob?: { id: string; title: string; skills?: number } | null;
  startedAt?: string;
  finishedAt?: string | null;
  error?: string | null;
  concurrency?: number;
  batchSize?: number;
  jobsPerWave?: number;
};

type StatusResponse = { success?: boolean; error?: string } & SkillExtractSession;

type StartResponse = {
  success?: boolean;
  error?: string;
  sessionId?: string | null;
  pending?: number | null;
  pendingKnown?: boolean;
  started?: boolean;
  message?: string;
};

async function parseJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({})) as T & { error?: string };
  if (!res.ok) {
    const error = new Error(data.error || `Request failed (${res.status})`) as Error & {
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
    const res = await fetch(`${API_BASE}/jobs/skill-extract/status${qs}`);
    return parseJson<StatusResponse>(res);
  });
}

export async function startSkillExtract(applierName?: string): Promise<StartResponse> {
  const res = await fetch(`${API_BASE}/jobs/skill-extract/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ applierName }),
  });
  return parseJson<StartResponse>(res);
}

export async function stopSkillExtract(): Promise<{ stopped: boolean; message?: string }> {
  const res = await fetch(`${API_BASE}/jobs/skill-extract/stop`, { method: "POST" });
  return parseJson(res);
}
