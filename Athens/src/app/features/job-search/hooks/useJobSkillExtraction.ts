import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useApplier } from "@/context/applier-context";
import { fetchSkillExtractStatus, type SkillExtractSession } from "@/app/api/jobSkillExtract";
import { useBackgroundTasks } from "@/app/context/BackgroundTaskContext";
import { skillExtractionSessionFromTask } from "../lib/skillExtractionState";

export function useJobSkillExtraction() {
  const { applier } = useApplier();
  const { latestTask, startTask, cancelTask, waitForTask } = useBackgroundTasks();
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

  useEffect(() => {
    if (!task || !["queued", "running", "cancelling"].includes(task.status)) return;
    const controller = new AbortController();
    void waitForTask(task.id, controller.signal).then((terminal) => {
      const result = skillExtractionSessionFromTask(terminal);
      if (terminal.status === "failed") {
        toast.error("Skill extraction failed", {
          description: terminal.error || "The extraction worker stopped unexpectedly.",
        });
      } else if (terminal.status === "cancelled") {
        toast.info("Skill extraction stopped");
      } else if ((result?.failed ?? 0) > 0) {
        toast.warning("Skill extraction finished with errors", {
          description: `${result?.processed ?? 0} processed · ${result?.failed ?? 0} failed.`,
        });
      } else {
        toast.success("Skill extraction completed", {
          description: `${result?.extracted ?? result?.processed ?? 0} job(s) updated.`,
        });
      }
      void refresh();
    }).catch((error) => {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        toast.error("Unable to monitor skill extraction");
      }
    });
    return () => controller.abort();
  }, [refresh, task?.id, waitForTask]);

  const start = useCallback(async () => {
    setLoading(true);
    try {
      const created = await startTask("skill_extraction", {});
      toast.success("Skill extraction queued", {
        description: pending != null
          ? `${pending} job(s) waiting. Live progress is shown in the toolbar.`
          : "Live progress is shown in the toolbar.",
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
