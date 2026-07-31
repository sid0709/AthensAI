import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useApplier } from "@/context/applier-context";
import { fetchTitleReviewStatus, type TitleReviewSession } from "@/app/api/jobTitleReview";
import type { BackgroundTask } from "@/app/api/backgroundTasks";
import { useBackgroundTasks } from "@/app/context/BackgroundTaskContext";

function taskSession(task: BackgroundTask | null, fallback: TitleReviewSession) {
  if (!task) return fallback;
  const progress = task.progress || {};
  const status = task.status === "queued"
    ? "running"
    : task.status === "cancelling"
      ? "stopping"
      : task.status === "completed_with_errors" ? "completed" : task.status;
  return {
    ...fallback,
    running: ["queued", "running", "cancelling"].includes(task.status),
    status,
    phase: (progress.phase ?? null) as TitleReviewSession["phase"],
    sessionId: task.id,
    total: progress.total == null ? undefined : Number(progress.total),
    processed: Number(progress.completed ?? 0),
    approved: Number(progress.approved ?? 0),
    reviewRequired: Number(progress.reviewRequired ?? 0),
    failed: Number(progress.failed ?? 0),
    remaining: progress.remaining == null ? undefined : Number(progress.remaining),
    startedAt: task.startedAt || undefined,
    finishedAt: task.finishedAt,
    error: task.error,
    concurrency: 10,
    batchSize: 10,
  } satisfies TitleReviewSession;
}

export function useTitleReviewSession({
  enabled = true,
  autoLoad = true,
}: { enabled?: boolean; autoLoad?: boolean; pollWhenIdle?: boolean } = {}) {
  const { applier } = useApplier();
  const { latestTask, startTask, cancelTask } = useBackgroundTasks();
  const task = latestTask("title_review");
  const [fallback, setFallback] = useState<TitleReviewSession>({ running: false, status: "idle" });
  const [loading, setLoading] = useState(false);
  const session = useMemo(() => taskSession(task, fallback), [fallback, task]);

  const refresh = useCallback(async () => {
    if (!enabled || !applier?.name) return null;
    try {
      const next = await fetchTitleReviewStatus(applier.name);
      setFallback(next);
      return next;
    } catch {
      return null;
    }
  }, [applier?.name, enabled]);

  useEffect(() => {
    if (autoLoad) void refresh();
  }, [autoLoad, refresh]);

  useEffect(() => {
    if (task && !task.status.match(/^(queued|running|cancelling)$/)) void refresh();
  }, [refresh, task?.id, task?.status]);

  const start = useCallback(async () => {
    if (!applier?.name) return null;
    setLoading(true);
    try {
      const created = await startTask("title_review", {});
      toast.success("Title review started", {
        description: fallback.pending != null ? `${fallback.pending} title(s) queued.` : "Reviewing pending titles.",
      });
      return { success: true, started: true, sessionId: created.id, pending: fallback.pending ?? undefined };
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to start title review");
      return null;
    } finally {
      setLoading(false);
    }
  }, [applier?.name, fallback.pending, startTask]);

  const stop = useCallback(async () => {
    if (!task || !["queued", "running", "cancelling"].includes(task.status)) return;
    setLoading(true);
    try {
      await cancelTask(task.id);
      toast.info("Stopping title review…");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to stop title review");
    } finally {
      setLoading(false);
    }
  }, [cancelTask, task]);

  const hydrate = useCallback((next: TitleReviewSession) => setFallback(next), []);

  return { session, loading, refresh, start, stop, hydrate };
}
