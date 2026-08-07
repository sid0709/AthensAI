import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useApplier } from "@/context/applier-context";
import {
  fetchTitleReviewStatus,
  startTitleReview,
  stopTitleReview,
  type TitleReviewSession,
} from "@/app/api/jobTitleReview";
import type { BackgroundTask } from "@/app/api/backgroundTasks";
import { useBackgroundTasks } from "@/app/context/BackgroundTaskContext";

function profileIdOf(applier: { _id?: unknown } | null | undefined): string | undefined {
  const id = applier?._id;
  return typeof id === "string" && id.trim() ? id.trim() : undefined;
}

function taskSession(task: BackgroundTask | null, fallback: TitleReviewSession) {
  if (!task) return fallback;
  // Status/bootstrap recovery can force-cancel a zombie while the local task
  // cache still mirrors queued/running/cancelling from before the restart.
  if (
    fallback.running === false
    && fallback.sessionId
    && fallback.sessionId === task.id
    && ["queued", "running", "cancelling"].includes(task.status)
  ) {
    return {
      ...fallback,
      sessionId: task.id,
      pending: fallback.pending,
      unreviewedCount: fallback.unreviewedCount,
      reviewRequiredCount: fallback.reviewRequiredCount,
      failedCount: fallback.failedCount,
    };
  }
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
  const { latestTask } = useBackgroundTasks();
  const task = latestTask("title_review");
  const [fallback, setFallback] = useState<TitleReviewSession>({ running: false, status: "idle" });
  const [loading, setLoading] = useState(false);
  const session = useMemo(() => taskSession(task, fallback), [fallback, task]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  // In-process athens-backend sessions: poll status while running (no background-task bus).
  useEffect(() => {
    if (!enabled || !session.running) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    pollRef.current = setInterval(() => {
      void refresh();
    }, 1500);
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [enabled, refresh, session.running]);

  const start = useCallback(async () => {
    if (!applier?.name) return null;
    setLoading(true);
    try {
      const next = await startTitleReview(applier.name, profileIdOf(applier));
      setFallback(next);
      if (next.running) {
        toast.success("Title review started");
      } else {
        toast.info(next.message || "Nothing to review");
      }
      return next;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to start title review");
      return null;
    } finally {
      setLoading(false);
    }
  }, [applier]);

  const stop = useCallback(async () => {
    if (!applier?.name) return;
    if (!session.running && session.status !== "stopping") return;
    setLoading(true);
    try {
      const next = await stopTitleReview(applier.name, profileIdOf(applier));
      setFallback(next);
      toast.info("Title review stopped");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to stop title review");
    } finally {
      setLoading(false);
    }
  }, [applier, refresh, session.running, session.status]);

  const hydrate = useCallback((next: TitleReviewSession) => setFallback(next), []);

  return { session, loading, refresh, start, stop, hydrate };
}
