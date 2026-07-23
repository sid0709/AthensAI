import { API_BASE } from "@/lib/api-base";

export type TitleScanSession = {
  running: boolean;
  status: "idle" | "running" | "completed" | "cancelled" | "failed";
  sessionId?: string;
  pending?: number;
  total?: number;
  processed?: number;
  classified?: number;
  failed?: number;
  remaining?: number;
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
  pending?: number;
  started?: boolean;
  message?: string;
};

async function parseJson<T>(res: Response): Promise<T> {
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export async function fetchTitleScanStatus(applierName?: string): Promise<TitleScanSession> {
  const qs = applierName ? `?applierName=${encodeURIComponent(applierName)}` : "";
  const res = await fetch(`${API_BASE}/jobs/title-scan/status${qs}`);
  return parseJson<StatusResponse>(res);
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
