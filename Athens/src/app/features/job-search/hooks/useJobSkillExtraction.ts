import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useApplier } from "@/context/applier-context";
import { fetchSkillExtractStatus, type SkillExtractSession } from "@/app/api/jobSkillExtract";
import { useBackgroundTasks } from "@/app/context/BackgroundTaskContext";
import { skillExtractionSessionFromTask } from "../lib/skillExtractionState";

export function useJobSkillExtraction() {
  const { applier } = useApplier();
  const { latestTask, cancelTask } = useBackgroundTasks();
  const task = latestTask("skill_extraction");
  const [fallback, setFallback] = useState<SkillExtractSession>({ running: false, status: "idle" });
  const [pending, setPending] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const session = useMemo(() => skillExtractionSessionFromTask(task) || fallback, [fallback, task]);

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
    if (pending == null || pending === 0) return null;
    toast.info("Skill extraction AI is not wired yet", {
      description:
        pending != null
          ? `${pending} APPROVED job(s) still need skills. Badge count is live from athens_metadata.`
          : "Badge count is live from athens_metadata.",
    });
    return null;
  }, [pending]);

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
