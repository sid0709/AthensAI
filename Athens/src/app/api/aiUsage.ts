import { API_BASE } from "@/lib/api-base";

export type AiUsageTotals = {
  calls: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
};

export type AiUsageByProviderRow = {
  _id: { provider: string; billedModel: string };
  calls: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
};

export type AiUsageByFeatureRow = {
  _id: string;
  calls: number;
  costUsd: number;
  totalTokens: number;
};

export type AiUsageByDayRow = {
  _id: string;
  calls: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
};

export type AiUsageSummaryResponse = {
  totals: AiUsageTotals;
  byProvider: AiUsageByProviderRow[];
  byFeature: AiUsageByFeatureRow[];
  byDay: AiUsageByDayRow[];
};

export type AiUsageCallRow = {
  requestId: string;
  createdAt?: string;
  service?: string;
  feature?: string;
  provider?: string;
  requestedModel?: string;
  billedModel?: string;
  modelMismatch?: boolean;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  durationMs?: number;
  success?: boolean;
  applierName?: string;
  runId?: string;
  jobId?: string;
  error?: string;
};

export type AiUsageRowsResponse = {
  rows: AiUsageCallRow[];
  count: number;
};

type QueryParams = {
  since?: string;
  until?: string;
  applierName?: string;
  feature?: string;
  limit?: number;
  /** Signed-in account name — required for admin-gated AI usage APIs */
  requesterName?: string;
};

function buildQuery(params: QueryParams): string {
  const q = new URLSearchParams();
  if (params.since) q.set("since", params.since);
  if (params.until) q.set("until", params.until);
  if (params.applierName) q.set("applierName", params.applierName);
  if (params.feature) q.set("feature", params.feature);
  if (params.limit != null) q.set("limit", String(params.limit));
  const s = q.toString();
  return s ? `?${s}` : "";
}

function adminHeaders(requesterName?: string): HeadersInit {
  const name = String(requesterName || "").trim();
  return name ? { "x-applier-name": name } : {};
}

async function parseJson<T>(res: Response): Promise<T> {
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

export async function fetchAiUsageSummary(params: QueryParams): Promise<AiUsageSummaryResponse> {
  const res = await fetch(`${API_BASE}/ai-usage/summary${buildQuery(params)}`, {
    headers: adminHeaders(params.requesterName),
  });
  return parseJson(res);
}

export async function fetchAiUsageRows(params: QueryParams): Promise<AiUsageRowsResponse> {
  const res = await fetch(`${API_BASE}/ai-usage${buildQuery({ ...params, limit: params.limit ?? 100 })}`, {
    headers: adminHeaders(params.requesterName),
  });
  return parseJson(res);
}

export type AiUsageMonitorKey = {
  provider: string;
  configured: boolean;
  masked: string | null;
};

export type AiUsageMonitorProviderRow = {
  provider: string;
  billedModel: string;
  calls: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
};

export type AiUsageMonitorFeatureRow = {
  feature: string;
  calls: number;
  costUsd: number;
  totalTokens: number;
};

export type AiUsageMonitorUserUsage = AiUsageTotals & {
  lastCallAt: string | null;
  byProvider: AiUsageMonitorProviderRow[];
  byFeature: AiUsageMonitorFeatureRow[];
};

export type AiUsageMonitorUser = {
  name: string;
  tier: string | null;
  vendorAllowed: boolean;
  fullName: string | null;
  email: string | null;
  defaultProvider: string | null;
  defaultModel: string | null;
  profileUpdatedAt: string | null;
  keys: AiUsageMonitorKey[];
  usage: AiUsageMonitorUserUsage;
};

export type AiUsageMonitorApiKey = {
  provider: string;
  masked: string | null;
  fingerprint: string;
  users: string[];
  calls: number;
  costUsd: number;
  totalTokens: number;
};

export type AiUsageMonitorResponse = {
  totals: AiUsageTotals & {
    registeredUsers: number;
    usersWithKeys: number;
    usersWithUsage: number;
    configuredKeys: number;
  };
  users: AiUsageMonitorUser[];
  apiKeys: AiUsageMonitorApiKey[];
  unassigned: { name: string; usage: AiUsageMonitorUserUsage }[];
};

export async function fetchAiUsageMonitor(
  params: Pick<QueryParams, "since" | "until" | "requesterName"> = {},
): Promise<AiUsageMonitorResponse> {
  const res = await fetch(`${API_BASE}/ai-usage/monitor${buildQuery(params)}`, {
    headers: adminHeaders(params.requesterName),
  });
  return parseJson(res);
}
