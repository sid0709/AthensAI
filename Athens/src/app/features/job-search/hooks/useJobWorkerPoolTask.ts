import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { useApplier } from "@/context/applier-context";
import { useBackgroundTasks } from "../../../context/BackgroundTaskContext";
import type { Job } from "../../../types";

const ACTIVE = new Set(["queued", "running", "cancelling"]);

export type JobWorkerPoolProgress = {
  done: number;
  total: number;
  failed?: number;
  applied?: number;
};

/** Job Search Worker pool bulk move, backed by a durable background task. */
export function useJobWorkerPoolTask(
  onJobUpdated: (job: Job) => void,
  markJobsApplied: (ids: string[]) => void,
  refreshStatusCounts: () => void,
) {
  const { applier } = useApplier();
  const { latestTask, startTask, cancelTask } = useBackgroundTasks();
  const task = latestTask("job_worker_pool");
  const running = Boolean(task && ACTIVE.has(task.status));
  const stopping = task?.status === "cancelling";
  const jobsByIdRef = useRef(new Map<string, Job>());
  const pooledRef = useRef(new Set<string>());
  const appliedRef = useRef(new Set<string>());
  const toastedRef = useRef<string | null>(null);
  const taskIdRef = useRef<string | null>(null);
  const seenActiveRef = useRef(new Set<string>());

  if (task?.id !== taskIdRef.current) {
    taskIdRef.current = task?.id ?? null;
    pooledRef.current = new Set();
    appliedRef.current = new Set();
  }

  useEffect(() => {
    if (task && ACTIVE.has(task.status)) seenActiveRef.current.add(task.id);
  }, [task]);

  useEffect(() => {
    if (!task) return;
    for (const [id, item] of Object.entries(task.progress.items || {})) {
      if (item.status !== "completed" || pooledRef.current.has(id)) continue;
      pooledRef.current.add(id);
      const job = jobsByIdRef.current.get(id);
      onJobUpdated(
        job
          ? { ...job, status: "worker-pool" }
          : ({ id, backendId: id, status: "worker-pool" } as Job),
      );
    }
    const applied = Array.isArray(task.progress.appliedIds)
      ? (task.progress.appliedIds as string[])
      : [];
    const fresh = applied.filter((id) => id && !appliedRef.current.has(id));
    if (fresh.length) {
      fresh.forEach((id) => appliedRef.current.add(id));
      markJobsApplied(fresh);
    }
  }, [markJobsApplied, onJobUpdated, task]);

  useEffect(() => {
    if (!task || ACTIVE.has(task.status)) return;
    if (!seenActiveRef.current.has(task.id)) return;
    const key = `${task.id}:${task.status}`;
    if (toastedRef.current === key) return;
    toastedRef.current = key;
    const completed = Number(task.progress.completed ?? 0);
    const failed = Number(task.progress.failed ?? 0);
    const applied = Array.isArray(task.progress.appliedIds)
      ? task.progress.appliedIds.length
      : Array.isArray((task.result as { appliedIds?: string[] } | null)?.appliedIds)
        ? (task.result as { appliedIds?: string[] }).appliedIds!.length
        : 0;
    void refreshStatusCounts();
    if (task.status === "cancelled") {
      toast.info(`Worker pool stopped · ${completed} moved`);
    } else if (task.status === "failed") {
      toast.error(task.error || "Failed to move jobs to Worker pool");
    } else if (failed) {
      toast.warning(`Moved ${completed} job${completed === 1 ? "" : "s"} to Worker pool (${failed} failed)`);
    } else {
      toast.success(
        applied
          ? `Moved ${completed} job${completed === 1 ? "" : "s"} to Worker pool · marked ${applied} other role${applied === 1 ? "" : "s"} applied`
          : `Moved ${completed} job${completed === 1 ? "" : "s"} to Worker pool`,
      );
    }
  }, [refreshStatusCounts, task]);

  const enqueue = useCallback(
    async (jobs: Job[], applyAllCompanyRoles: boolean) => {
      if (running) return false;
      if (!applier?.name) {
        toast.error("Select a profile before updating status");
        return false;
      }
      const eligible = jobs.filter((job) => job.status === "posted");
      if (!eligible.length) {
        toast.message("Nothing to move to Worker pool", {
          description: "Select New (posted) jobs only.",
        });
        return false;
      }
      const next = new Map(jobsByIdRef.current);
      for (const job of eligible) next.set(job.backendId || job.id, job);
      jobsByIdRef.current = next;
      try {
        const created = await startTask("job_worker_pool", {
          jobIds: eligible.map((job) => job.backendId || job.id),
          applyAllCompanyRoles,
        });
        seenActiveRef.current.add(created.id);
        return true;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to queue Worker pool");
        return false;
      }
    },
    [applier?.name, running, startTask],
  );

  const cancel = useCallback(() => {
    if (!task || !ACTIVE.has(task.status)) return;
    void cancelTask(task.id).catch((error) => {
      toast.error(error instanceof Error ? error.message : "Failed to stop Worker pool");
    });
  }, [cancelTask, task]);

  const progress: JobWorkerPoolProgress | null = running && task
    ? {
        done: Number(task.progress.completed ?? 0) + Number(task.progress.failed ?? 0),
        total: Number(task.progress.total ?? 0),
        failed: Number(task.progress.failed ?? 0),
        applied: Array.isArray(task.progress.appliedIds) ? task.progress.appliedIds.length : 0,
      }
    : null;

  return { enqueue, cancel, running, stopping, progress };
}
