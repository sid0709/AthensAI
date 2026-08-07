import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useApplier } from "@/context/applier-context";
import {
  fetchSkillExtractStatus,
  startSkillExtract,
  stopSkillExtract,
  type SkillExtractSession,
} from "@/app/api/jobSkillExtract";
import { useBackgroundTasks } from "@/app/context/BackgroundTaskContext";
import { skillExtractionSessionFromTask } from "../lib/skillExtractionState";

function profileIdOf(applier: { _id?: unknown } | null | undefined): string | undefined {
  const id = applier?._id;
  return typeof id === "string" && id.trim() ? id.trim() : undefined;
}

export function useJobSkillExtraction() {
  const { applier } = useApplier();
  const { latestTask } = useBackgroundTasks();
  const task = latestTask("skill_extraction");
  const [fallback, setFallback] = useState<SkillExtractSession>({ running: false, status: "idle" });
  const [pending, setPending] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const session = useMemo(() => skillExtractionSessionFromTask(task) || fallback, [fallback, task]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isRunning = session.running;

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

  useEffect(() => {
    if (!isRunning) {
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
  }, [isRunning, refresh]);

  const start = useCallback(async () => {
    if (pending == null || pending === 0) return null;
    if (!applier?.name) {
      toast.error("Sign in required to run AI analyze");
      return null;
    }
    setLoading(true);
    try {
      const next = await startSkillExtract(applier.name, profileIdOf(applier));
      setFallback(next);
      setPending(next.pending ?? pending);
      if (next.running) {
        toast.success("AI analyze started");
      } else {
        toast.info(next.message || "Nothing to analyze");
      }
      return next;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to start AI analyze");
      return null;
    } finally {
      setLoading(false);
    }
  }, [applier, pending]);

  const stop = useCallback(async () => {
    if (!applier?.name) return;
    if (!isRunning && session.status !== "stopping") return;
    setLoading(true);
    try {
      const next = await stopSkillExtract(applier.name, profileIdOf(applier));
      setFallback(next);
      setPending(next.pending ?? null);
      toast.info("AI analyze stopped");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to stop AI analyze");
    } finally {
      setLoading(false);
    }
  }, [applier, isRunning, refresh, session.status]);

  return { session, pending, loading, isRunning, start, stop, refresh };
}
