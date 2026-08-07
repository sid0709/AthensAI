const OBJECT_ID_RE = /^[a-f\d]{24}$/i;

export function heuristicRecommend(input: {
  useCustomizedResume: boolean;
  warning: string;
  reason: string;
}) {
  return {
    result: {
      recommendedResume: null as string | null,
      matchedCatalogKey: null as string | null,
      useCustomizedResume: input.useCustomizedResume,
      warning: input.warning,
      reason: input.reason,
    },
    mode: 'heuristic' as const,
    usage: null as Record<string, unknown> | null,
    requestId: null as string | null,
  };
}

export function normalizeRecommendJobIds(
  raw: string[],
  maxJobs: number,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of Array.isArray(raw) ? raw : []) {
    const jobId = String(id || '').trim();
    if (!OBJECT_ID_RE.test(jobId) || seen.has(jobId)) continue;
    seen.add(jobId);
    out.push(jobId);
    if (out.length >= maxJobs) break;
  }
  return out;
}
