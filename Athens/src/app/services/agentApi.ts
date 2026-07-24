import { io, type Socket } from "socket.io-client";
import { API_BASE, resolveDevServiceUrl } from "@/lib/api-base";
import type {
  ActivityEntry,
  AvalonHealthData,
  DashboardData,
  HealthData,
  RunSummary,
} from "../types/agent";
import { DEFAULT_SESSION_ID } from "@avalon/shared";
import { getFirebaseIdToken } from "@/lib/firebase-client";

const AGENTS_BASE = `${API_BASE.replace(/\/$/, "")}/agents`;

function qs(profileId: string | null | undefined, extra: Record<string, string> = {}) {
  const p = new URLSearchParams();
  if (profileId) p.set("profileId", profileId);
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${AGENTS_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok || (data as { error?: string }).error) {
    throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  }
  return data;
}

export function avalonRelayUrl() {
  return resolveDevServiceUrl(
    import.meta.env.VITE_AVALON_SERVER,
    "/avalon",
    "http://localhost:3847",
  );
}

const AVALON_SESSION_STORAGE_KEY = "athens-avalon-session";

/**
 * The user-configured Avalon session ID, persisted across reloads so this
 * Athens instance always re-registers into ITS session — never the shared
 * "default" one that another user's extension may occupy.
 */
export function storedAvalonSessionId(): string {
  try {
    return localStorage.getItem(AVALON_SESSION_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function persistAvalonSessionId(sessionId: string) {
  try {
    localStorage.setItem(AVALON_SESSION_STORAGE_KEY, sessionId);
  } catch {
    /* storage unavailable */
  }
}

/** Socket.IO client options — Avalon relay is a dedicated process (@avalon/backend). */
export function avalonRelaySocketOptions(): { url?: string; path?: string } {
  const configured = import.meta.env.VITE_AVALON_SERVER?.trim();
  if (import.meta.env.DEV && (!configured || avalonRelayUrl() === "/avalon")) {
    return { path: "/avalon/socket.io" };
  }
  return {
    url: avalonRelayUrl(),
    path: "/avalon/socket.io",
  };
}

const AVALON_SOCKET_COMMON = {
  transports: ["websocket", "polling"] as const,
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  path: "/avalon/socket.io",
  auth: async (callback: (value: { token: string }) => void) => {
    callback({ token: await getFirebaseIdToken() });
  },
};

export function createAvalonSocket(serverUrl: string): Socket {
  if (serverUrl === "/avalon") {
    return io({ ...AVALON_SOCKET_COMMON });
  }
  return io(serverUrl, { ...AVALON_SOCKET_COMMON });
}

export function avalonRelayHealthUrl(): string {
  const base = avalonRelayUrl();
  return base === "/avalon" ? "/avalon/health" : `${base.replace(/\/$/, "")}/avalon/health`;
}

/** Wait for the relay HTTP health endpoint before opening a websocket (avoids Vite proxy noise on boot). */
export async function waitForAvalonRelay(
  attempts = 30,
  intervalMs = 1000,
): Promise<boolean> {
  const healthUrl = avalonRelayHealthUrl();
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(healthUrl, { cache: "no-store" });
      if (res.ok) return true;
    } catch {
      // Relay still starting — retry.
    }
    if (i < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  return false;
}

/** Probe Avalon relay via HTTP — does not steal the controller socket slot. */
export async function fetchAvalonHealth(sessionId = DEFAULT_SESSION_ID): Promise<AvalonHealthData> {
  try {
    const res = await fetch(avalonRelayHealthUrl());
    if (!res.ok) return { ok: false, extension: false };
    const data = (await res.json()) as {
      ok?: boolean;
      active?: Array<{
        id?: string;
        sessionId?: string;
        peers?: { extension?: boolean };
      }>;
    };
    const session =
      data.active?.find((s) => (s.sessionId ?? s.id) === sessionId) ?? data.active?.[0];
    const resolvedId = session?.sessionId ?? session?.id ?? sessionId;
    return {
      ok: Boolean(data.ok),
      extension: Boolean(session?.peers?.extension),
      sessionId: resolvedId,
    };
  } catch {
    return { ok: false, extension: false };
  }
}

export async function fetchAgentHealth(): Promise<HealthData | null> {
  try {
    return await json<HealthData>("/health");
  } catch {
    return null;
  }
}

export async function fetchAgentDashboard(profileId: string | null): Promise<DashboardData | null> {
  try {
    return await json<DashboardData>(`/dashboard${qs(profileId)}`);
  } catch {
    return null;
  }
}

export async function fetchAgentRuns(profileId: string | null, limit = 50): Promise<RunSummary[]> {
  try {
    const data = await json<{ runs: RunSummary[] }>(`/runs${qs(profileId, { limit: String(limit) })}`);
    return data.runs || [];
  } catch {
    return [];
  }
}

export async function fetchAgentActivity(profileId: string | null, limit = 50): Promise<ActivityEntry[]> {
  try {
    const data = await json<{ activity: ActivityEntry[] }>(`/activity${qs(profileId, { limit: String(limit) })}`);
    return data.activity || [];
  } catch {
    return [];
  }
}

export async function fetchAgentModels(profileId: string): Promise<{ id: string }[]> {
  const data = await json<{ models: { id: string }[] }>(`/models${qs(profileId)}`);
  return data.models || [];
}

export async function fetchJobSources(profileId: string): Promise<{ title: string; type: string; posted: number }[]> {
  const data = await json<{ sources: { title: string; type: string; posted: number }[] }>(`/job-sources${qs(profileId)}`);
  return data.sources || [];
}

export interface JobCandidate {
  id: string;
  title: string;
  company: string;
  url: string;
  source: string;
}

/** Optional filters for the candidate transfer list (mirror Job Search's filters). */
export interface CandidateJobFilters {
  /** Title contains (case-insensitive). Maps to the backend `q` param. */
  titleQuery?: string;
  /** Posted on/after this date (YYYY-MM-DD). */
  postedFrom?: string;
  /** Posted on/before this date (YYYY-MM-DD). */
  postedTo?: string;
}

/**
 * Candidate jobs for the transfer list, in Job Search's **Best match** rank order
 * (sort=recommended), posted (not-yet-applied) only — so the list matches what the
 * user sees in Job Search. Hits the same /jobs/list endpoint Job Search uses.
 *
 * `source` is optional: when omitted, all job sources are searched (lets the
 * title/date filters stand on their own without picking a source first).
 */
export async function fetchCandidateJobs(
  applierName: string,
  source: string,
  limit = 200,
  filters: CandidateJobFilters = {},
): Promise<JobCandidate[]> {
  const body: Record<string, unknown> = {
    sort: "recommended", // Best match
    applied: false, // posted, not yet applied
    applierName,
    page: 1,
    limit,
  };
  if (source) body.jobSources = source;
  if (filters.titleQuery?.trim()) body.q = filters.titleQuery.trim();
  if (filters.postedFrom) body.postedAtFrom = filters.postedFrom;
  if (filters.postedTo) body.postedAtTo = filters.postedTo;

  const res = await fetch(`${API_BASE.replace(/\/$/, "")}/jobs/list`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { data?: Record<string, unknown>[] };
  const docs = Array.isArray(data.data) ? data.data : [];
  return docs
    .map((d) => {
      const company = d.company as { name?: string } | undefined;
      // Prefer Mongo `_id` only — the numeric `id` field is a different scrape key
      // and must not be used for résumé lookup (Job Search stores under `_id`).
      const id =
        d._id != null && typeof d._id === "object" && "$oid" in (d._id as object)
          ? String((d._id as { $oid: string }).$oid)
          : String(d._id ?? "");
      return {
        id,
        title: String(d.title ?? ""),
        company: String(company?.name ?? ""),
        url: String(d.applyLink ?? d.url ?? ""),
        source: String(d.source ?? source),
      };
    })
    .filter((j) => j.id && /^https?:\/\//i.test(j.url));
}
