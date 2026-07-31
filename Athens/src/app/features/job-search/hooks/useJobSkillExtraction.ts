import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useApplier } from "@/context/applier-context";
import { fetchSkillExtractStatus, type SkillExtractSession } from "@/app/api/jobSkillExtract";
import type { BackgroundTask } from "@/app/api/backgroundTasks";
import { useBackgroundTasks } from "@/app/context/BackgroundTaskContext";

function sessionFromTask(task: BackgroundTask | null): SkillExtractSession | null {
  if (!task) return null;
  const progress = task.progress || {};
  const status: SkillExtractSession["status"] = task.status === "queued"
    ? "running"
    : task.status === "cancelling"
      ? "stopping"
      : task.status === "completed_with_errors" ? "completed" : task.status;
  return {
    running: ["queued", "running", "cancelling"].includes(task.status),
    status,
    sessionId: task.id,
    total: progress.total as number | null | undefined,
    processed: Number(progress.completed ?? 0),
    extracted: Number(progress.extracted ?? 0),
    failed: Number(progress.failed ?? 0),
    retried: Number(progress.retried ?? 0),
    cancelled: Number(progress.cancelled ?? 0),
    remaining: progress.remaining as number | null | undefined,
    phase: progress.phase as SkillExtractSession["phase"],
    inflight: Number(progress.active ?? 0),
    lastJob: progress.lastJob as SkillExtractSession["lastJob"],
    startedAt: task.startedAt || undefined,
    finishedAt: task.finishedAt,
    error: task.error,
    concurrency: 8,
    batchSize: 8,
    jobsPerWave: 64,
  };
}

export function useJobSkillExtraction() {
  const { applier } = useApplier();
  const { latestTask, startTask, cancelTask } = useBackgroundTasks();
  const task = latestTask("skill_extraction");
  const [fallback, setFallback] = useState<SkillExtractSession>({ running: false, status: "idle" });
  const [pending, setPending] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const session = useMemo(() => sessionFromTask(task) || fallback, [fallback, task]);

  const refresh = useCallback(async () => {
    try {
      const status = await fetchSkillExtractStatus(applier?.name);
      setFallback(status);
      setPending(status.pending ?? null);
      return status;
    } catch {
      return null;
    }
  }, [applier?.name]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (task && !task.status.match(/^(queued|running|cancelling)$/)) void refresh();
  }, [refresh, task?.id, task?.status]);

  const start = useCallback(async () => {
    setLoading(true);
    try {
      const created = await startTask("skill_extraction", {});
      toast.success("Skill extraction started", {
        description: pending != null
          ? `${pending} job(s) queued.`
          : "Processing jobs that do not have extracted skills.",
      });
      return created;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to start extraction");
      return null;
    } finally {
      setLoading(false);
    }
  }, [pending, startTask]);

  const stop = useCallback(async () => {
    if (!task || !["queued", "running", "cancelling"].includes(task.status)) return;
    setLoading(true);
    try {
      await cancelTask(task.id);
      toast.info("Stopping extraction…");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to stop extraction");
    } finally {
      setLoading(false);
    }
  }, [cancelTask, task]);

  return { session, pending, loading, isRunning: session.running, start, stop, refresh };
}
