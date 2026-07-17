import { API_BASE } from "@/lib/api-base";

const AGENTS_BASE = `${API_BASE.replace(/\/$/, "")}/agents`;

export interface ApplyLogEvent {
  at: string;
  level: "info" | "success" | "warn" | "error";
  phase?: string;
  message: string;
  /** Structured payload for debugging (tree summary, plan, page snapshot, script, verdict…). */
  data?: unknown;
}

export interface ApplyLogPayload {
  runId: string;
  applierName?: string;
  job?: { id: string; title: string; company?: string; url: string; source?: string };
  meta?: Record<string, unknown>;
  events?: ApplyLogEvent[];
  status?: string;
  finished?: boolean;
}

/**
 * Persist a batch of apply-run events to the backend (local JSONL file + MongoDB).
 * Fire-and-forget: logging must never break the apply flow, so this never throws.
 */
export async function postApplyLog(payload: ApplyLogPayload): Promise<void> {
  try {
    await fetch(`${AGENTS_BASE}/apply-log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch {
    /* logging is best-effort */
  }
}

/** Rolled-up metadata for one apply run (list view — no event array). */
export interface ApplyRunSummary {
  runId: string;
  applierName?: string | null;
  job?: { id: string; title: string; company?: string; url: string; source?: string } | null;
  meta?: Record<string, unknown> | null;
  status?: string | null;
  startedAt: string;
  finishedAt?: string | null;
  updatedAt?: string | null;
}

/** A single run with its full event timeline. */
export interface ApplyRunDetail extends ApplyRunSummary {
  events?: ApplyLogEvent[];
}

/** Recent apply runs (metadata only) for the history panel — newest first. */
export async function fetchApplyRuns(applierName?: string, limit = 50): Promise<ApplyRunSummary[]> {
  try {
    const params = new URLSearchParams();
    if (applierName) params.set("applierName", applierName);
    params.set("limit", String(limit));
    const res = await fetch(`${AGENTS_BASE}/apply-runs?${params.toString()}`);
    if (!res.ok) return [];
    const data = (await res.json()) as { success?: boolean; runs?: ApplyRunSummary[] };
    return data.success && Array.isArray(data.runs) ? data.runs : [];
  } catch {
    return [];
  }
}

/** One run's full event timeline, for expanding a history entry. */
export async function fetchApplyRun(runId: string): Promise<ApplyRunDetail | null> {
  try {
    const res = await fetch(`${AGENTS_BASE}/apply-runs/${encodeURIComponent(runId)}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { success?: boolean; run?: ApplyRunDetail };
    return data.success && data.run ? data.run : null;
  } catch {
    return null;
  }
}
