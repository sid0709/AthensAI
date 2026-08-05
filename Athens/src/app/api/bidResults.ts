import { API_BASE } from "@/lib/api-base";
import type {
  BidAiUsageRow,
  BidResult,
  BidResultStatus,
  BidResultStats,
  BidReviewEvent,
} from "../features/bid-management/types";

type ApiEnvelope<T> = T & { success?: boolean; error?: string };

async function parseJson<T>(res: Response): Promise<T> {
  const data = (await res.json()) as ApiEnvelope<T>;
  if (!res.ok || data.success === false) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

/** API may still return company as { name, tags, logo } from older task rows. */
function companyLabel(company: unknown): string {
  if (typeof company === "string") {
    const s = company.trim();
    return s || "Unknown";
  }
  if (company && typeof company === "object") {
    const name = (company as { name?: unknown; companyName?: unknown }).name
      ?? (company as { companyName?: unknown }).companyName;
    if (typeof name === "string" && name.trim()) return name.trim();
  }
  return "Unknown";
}

function normalizeBidResult(row: BidResult): BidResult {
  const stackMatch = row.resumeStackMatch;
  return {
    ...row,
    job: {
      ...row.job,
      company: companyLabel(row.job?.company),
      title: typeof row.job?.title === "string" ? row.job.title : "Untitled role",
      location: typeof row.job?.location === "string" ? row.job.location : "—",
      source: typeof row.job?.source === "string" ? row.job.source : "—",
      applyUrl: typeof row.job?.applyUrl === "string" ? row.job.applyUrl : "#",
    },
    rejectCount: Number(row.rejectCount || 0) || 0,
    resubmitCount: Number(row.resubmitCount || 0) || 0,
    resumeMismatch: Boolean(row.resumeMismatch),
    resumeRenamed: Boolean(row.resumeRenamed),
    useCustomizedResume: Boolean(row.useCustomizedResume),
    analysisSummary:
      typeof row.analysisSummary === "string" ? row.analysisSummary : null,
    analysisFormAnswers: Array.isArray(row.analysisFormAnswers)
      ? row.analysisFormAnswers
      : [],
    analysisMode:
      row.analysisMode === "llm" || row.analysisMode === "heuristic"
        ? row.analysisMode
        : null,
    analysisPageUrl:
      typeof row.analysisPageUrl === "string" ? row.analysisPageUrl : null,
    analysisPageTitle:
      typeof row.analysisPageTitle === "string" ? row.analysisPageTitle : null,
    analysisUsage:
      row.analysisUsage && typeof row.analysisUsage === "object"
        ? row.analysisUsage
        : null,
    analysisRequestId:
      typeof row.analysisRequestId === "string" ? row.analysisRequestId : null,
    analyzedAt: typeof row.analyzedAt === "string" ? row.analyzedAt : null,
    flagAnalysisMode:
      row.flagAnalysisMode === "llm" || row.flagAnalysisMode === "heuristic"
        ? row.flagAnalysisMode
        : null,
    flagAnalysisUsage:
      row.flagAnalysisUsage && typeof row.flagAnalysisUsage === "object"
        ? row.flagAnalysisUsage
        : null,
    flagAnalysisRequestId:
      typeof row.flagAnalysisRequestId === "string"
        ? row.flagAnalysisRequestId
        : null,
    flagAnalyzedAt:
      typeof row.flagAnalyzedAt === "string" ? row.flagAnalyzedAt : null,
    recommendedResumeStack:
      typeof row.recommendedResumeStack === "string"
        ? row.recommendedResumeStack
        : null,
    recommendedResumeReason:
      typeof row.recommendedResumeReason === "string"
        ? row.recommendedResumeReason
        : null,
    recommendWarning:
      typeof row.recommendWarning === "string" ? row.recommendWarning : null,
    recommendedAt:
      typeof row.recommendedAt === "string" ? row.recommendedAt : null,
    recommendMode:
      row.recommendMode === "llm" || row.recommendMode === "heuristic"
        ? row.recommendMode
        : null,
    recommendUsage:
      row.recommendUsage && typeof row.recommendUsage === "object"
        ? row.recommendUsage
        : null,
    recommendRequestId:
      typeof row.recommendRequestId === "string"
        ? row.recommendRequestId
        : null,
    resumeStackMatch:
      stackMatch === "match" ||
      stackMatch === "mismatch" ||
      stackMatch === "unknown"
        ? stackMatch
        : null,
    recordings: Array.isArray(row.recordings) ? row.recordings : undefined,
    resumeAudits: Array.isArray(row.resumeAudits) ? row.resumeAudits : undefined,
  };
}

export async function fetchBidRecordingUrl(
  applierName: string,
  storagePath: string,
): Promise<{
  bucket: string;
  path: string;
  url: string;
  expiresInMs: number;
  contentType: string | null;
  size: number;
  name: string;
}> {
  const params = new URLSearchParams({
    applierName,
    path: storagePath,
  });
  const res = await fetch(`${API_BASE}/bid-results/recording-url?${params}`);
  return parseJson(res);
}

export async function fetchBidResults(applierName: string): Promise<BidResult[]> {
  const params = new URLSearchParams({ applierName });
  const res = await fetch(`${API_BASE}/bid-results?${params}`);
  const data = await parseJson<{ results?: BidResult[] }>(res);
  const rows = Array.isArray(data.results) ? data.results : [];
  return rows.map(normalizeBidResult);
}

export async function fetchRejectedBidResults(applierName: string): Promise<BidResult[]> {
  const params = new URLSearchParams({ applierName });
  const res = await fetch(`${API_BASE}/bid-results/rejected?${params}`);
  const data = await parseJson<{ results?: BidResult[] }>(res);
  const rows = Array.isArray(data.results) ? data.results : [];
  return rows.map(normalizeBidResult);
}

export async function fetchBidResultStats(
  applierName: string,
  options?: { since?: string | null; until?: string | null },
): Promise<BidResultStats | null> {
  const params = new URLSearchParams({ applierName });
  if (options?.since) params.set("since", options.since);
  if (options?.until) params.set("until", options.until);
  const res = await fetch(`${API_BASE}/bid-results/stats?${params}`);
  const data = await parseJson<{ stats?: BidResultStats }>(res);
  return data.stats ?? null;
}

export async function fetchBidResultEvents(
  id: string,
  applierName: string,
): Promise<BidReviewEvent[]> {
  const params = new URLSearchParams({ applierName });
  const res = await fetch(
    `${API_BASE}/bid-results/${encodeURIComponent(id)}/events?${params}`,
  );
  const data = await parseJson<{ events?: BidReviewEvent[] }>(res);
  return Array.isArray(data.events) ? data.events : [];
}

export async function fetchBidResultAiUsage(
  id: string,
  applierName: string,
): Promise<BidAiUsageRow[]> {
  const params = new URLSearchParams({ applierName });
  const res = await fetch(
    `${API_BASE}/bid-results/${encodeURIComponent(id)}/ai-usage?${params}`,
  );
  const data = await parseJson<{ rows?: BidAiUsageRow[] }>(res);
  return Array.isArray(data.rows) ? data.rows : [];
}

export async function patchBidResultStatus(
  id: string,
  applierName: string,
  status: Extract<BidResultStatus, "submitted" | "reviewed" | "rejected">,
  options?: { rejectReason?: string | null },
): Promise<BidResult | null> {
  const body: Record<string, unknown> = { applierName, status };
  if (status === "rejected" && options?.rejectReason != null) {
    body.rejectReason = options.rejectReason;
  }
  const res = await fetch(`${API_BASE}/bid-results/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await parseJson<{ result?: BidResult }>(res);
  return data.result ? normalizeBidResult(data.result) : null;
}

export async function markBidResultFixed(
  applierName: string,
  jobIdOrId: string,
): Promise<BidResult | null> {
  const res = await fetch(`${API_BASE}/bid-results/mark-fixed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ applierName, jobId: jobIdOrId }),
  });
  const data = await parseJson<{ result?: BidResult }>(res);
  return data.result ? normalizeBidResult(data.result) : null;
}
