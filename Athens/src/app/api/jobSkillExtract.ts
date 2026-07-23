import { API_BASE } from "@/lib/api-base";

export type SkillExtractSession = {
  running: boolean;
  status: "idle" | "running" | "completed" | "cancelled" | "failed";
  sessionId?: string;
  pending?: number;
  total?: number;
  processed?: number;
  extracted?: number;
  failed?: number;
  retried?: number;
  remaining?: number;
  lastJob?: { id: string; title: string; skills?: number } | null;
  startedAt?: string;
  finishedAt?: string | null;
  error?: string | null;
  concurrency?: number;
};

type StatusResponse = { success?: boolean; error?: string } & SkillExtractSession;

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

export async function fetchSkillExtractStatus(applierName?: string): Promise<SkillExtractSession> {
  const qs = applierName
    ? `?applierName=${encodeURIComponent(applierName)}`
    : "";
  const res = await fetch(`${API_BASE}/jobs/skill-extract/status${qs}`);
  return parseJson<StatusResponse>(res);
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
