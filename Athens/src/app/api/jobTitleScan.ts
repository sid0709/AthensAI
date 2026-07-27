import { API_BASE } from "@/lib/api-base";
import { retryTransient } from "@/lib/transient-retry";

export type TitleScanSession = {
  running: boolean;
  status: "idle" | "running" | "completed" | "cancelled" | "failed";
  sessionId?: string;
  pending?: number | null;
  pendingKnown?: boolean;
  total?: number | null;
  processed?: number;
  classified?: number;
  failed?: number;
  remaining?: number | null;
  lastJob?: { id: string; title: string; role?: string | null; batchSize?: number } | null;
  startedAt?: string;
  finishedAt?: string | null;
  error?: string | null;
  concurrency?: number;
  batchSize?: number;
};

type StatusResponse = { success?: boolean; error?: string } & TitleScanSession;

type StartResponse = {
  success?: boolean;
  error?: string;
  sessionId?: string | null;
  pending?: number | null;
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

export async function fetchTitleScanStatus(applierName?: string): Promise<TitleScanSession> {
  const qs = applierName ? `?applierName=${encodeURIComponent(applierName)}` : "";
  return retryTransient(async () => {
    const res = await fetch(`${API_BASE}/jobs/title-scan/status${qs}`);
    return parseJson<StatusResponse>(res);
  });
}

export async function startTitleScan(applierName?: string): Promise<StartResponse> {
  const res = await fetch(`${API_BASE}/jobs/title-scan/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ applierName }),
  });
  return parseJson<StartResponse>(res);
}

export async function stopTitleScan(applierName?: string): Promise<{ stopped: boolean; message?: string }> {
  const res = await fetch(`${API_BASE}/jobs/title-scan/stop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ applierName }),
  });
  return parseJson(res);
}
