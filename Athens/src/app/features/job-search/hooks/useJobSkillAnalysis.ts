import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { API_BASE } from "@/lib/api-base";
import { useBackgroundTasks } from "@/app/context/BackgroundTaskContext";
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
  const [taskId, setTaskId] = useState<string | null>(null);
  const handledTasks = useRef(new Set<string>());
  const { tasks, startTask } = useBackgroundTasks();

  const refresh = useCallback(async () => {
    if (!backendId) return;
    const next = await fetchAnalysis(backendId);
    setAnalysis(next);
    return next;
  }, [backendId]);

  useEffect(() => {
    if (initial) setAnalysis(initial);
  }, [initial]);

  const task = useMemo(() => {
    const exact = taskId ? tasks.find((candidate) => candidate.id === taskId) : null;
    if (exact) return exact;
    return tasks.find((candidate) => candidate.type === "job_analysis"
      && Array.isArray(candidate.progress.targetIds)
      && (candidate.progress.targetIds as string[]).includes(String(backendId || ""))) || null;
  }, [backendId, taskId, tasks]);

  useEffect(() => {
    if (!task) return;
    if (task.status === "queued" || task.status === "running" || task.status === "cancelling") {
      setAnalysis((current) => ({ ...current, status: task.status === "queued" ? "queued" : "analyzing" }));
      return;
    }
    if (handledTasks.current.has(task.id)) return;
    handledTasks.current.add(task.id);
    if (task.status === "failed" || task.status === "completed_with_errors") {
      setAnalysis((current) => ({ ...current, status: "failed", error: task.error || "Analyze failed" }));
      setError(task.error || "Analyze failed");
      return;
    }
    if (task.status === "completed") void refresh().catch(() => undefined);
  }, [refresh, task]);

  const analyze = useCallback(
    async (options: AnalyzeOptions = {}) => {
      if (!backendId) {
        setError("This job is not linked to the server yet.");
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const nextTask = await startTask("job_analysis", { recordIds: [backendId] });
        setTaskId(nextTask.id);
        setAnalysis((prev) => ({
          ...prev,
          status: "queued",
          queuedAt: new Date().toISOString(),
        }));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Analyze failed");
      } finally {
        setLoading(false);
      }
    },
    [backendId, startTask],
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
