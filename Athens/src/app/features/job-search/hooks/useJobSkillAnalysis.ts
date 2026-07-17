import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE } from "@/lib/api-base";
import type { SkillAnalysis, SkillAnalysisStatus, SkillAnalysisUsage } from "../../../types";

type AnalyzeOptions = {
  applierName?: string;
};

async function fetchAnalysis(jobId: string): Promise<SkillAnalysis> {
  const res = await fetch(`${API_BASE}/jobs/${encodeURIComponent(jobId)}/skill-analysis`);
  const data = (await res.json()) as {
    success?: boolean;
    skillAnalysis?: SkillAnalysis;
    error?: string;
  };
  if (!res.ok || !data.success) {
    throw new Error(data.error || "Failed to load analysis status");
  }
  return data.skillAnalysis || { status: "pending" };
}

export function useJobSkillAnalysis(backendId?: string, initial?: SkillAnalysis) {
  const [analysis, setAnalysis] = useState<SkillAnalysis>(initial || { status: "pending" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!backendId) return;
    const next = await fetchAnalysis(backendId);
    setAnalysis(next);
    return next;
  }, [backendId]);

  const startPoll = useCallback(() => {
    stopPoll();
    pollRef.current = setInterval(() => {
      void refresh().catch(() => undefined);
    }, 2500);
  }, [refresh, stopPoll]);

  useEffect(() => {
    if (initial) setAnalysis(initial);
  }, [initial]);

  useEffect(() => {
    return () => stopPoll();
  }, [stopPoll]);

  useEffect(() => {
    const s = analysis.status;
    if (s === "queued" || s === "analyzing") startPoll();
    else stopPoll();
  }, [analysis.status, startPoll, stopPoll]);

  const analyze = useCallback(
    async (options: AnalyzeOptions = {}) => {
      if (!backendId) {
        setError("This job is not linked to the server yet.");
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${API_BASE}/jobs/${encodeURIComponent(backendId)}/analyze`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ applierName: options.applierName }),
        });
        const data = (await res.json()) as {
          success?: boolean;
          status?: SkillAnalysisStatus;
          error?: string;
        };
        if (!res.ok || !data.success) {
          throw new Error(data.error || "Analyze request failed");
        }
        setAnalysis((prev) => ({
          ...prev,
          status: data.status || "queued",
          queuedAt: new Date().toISOString(),
        }));
        startPoll();
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Analyze failed");
      } finally {
        setLoading(false);
      }
    },
    [backendId, refresh, startPoll],
  );

  return { analysis, loading, error, analyze, refresh };
}

export function skillAnalysisLabel(status: SkillAnalysisStatus): string {
  switch (status) {
    case "analyzed":
      return "Analyzed";
    case "analyzing":
      return "Analyzing…";
    case "queued":
      return "Queued";
    case "failed":
      return "Failed";
    default:
      return "Not analyzed";
  }
}

/** Format DeepSeek usage cost for job card display (deepseek-v4-flash pricing on server). */
export function formatAnalysisCost(usage?: SkillAnalysisUsage | null): string | null {
  if (!usage || usage.cost == null || !Number.isFinite(usage.cost)) return null;
  const inTok = usage.inputTokens ?? 0;
  const outTok = usage.outputTokens ?? 0;
  if (inTok + outTok === 0) {
    return usage.cost === 0 ? "$0.0000 · graph only" : `$${usage.cost.toFixed(4)}`;
  }
  const cost = `$${usage.cost.toFixed(4)}`;
  return `${cost} · ${inTok.toLocaleString()} in · ${outTok.toLocaleString()} out`;
}
