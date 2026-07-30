import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useApplier } from "@/context/applier-context";
import { fetchJobsWithGeneratedResumes } from "../../../api/jobs";
import { useBackgroundTasks } from "../../../context/BackgroundTaskContext";
import type { BackgroundTaskItem } from "../../../api/backgroundTasks";
import type { Job } from "../../../types";

export type JobResumeGenerationStatus = "generating" | "done" | "error";

export type JobResumeBulkProgress = {
  done: number;
  total: number;
  active: number;
  partial?: number;
  phase?: "start" | "removing" | "finalizing" | "done";
  failed?: number;
};

export type JobResumeGenerationState = {
  status: JobResumeGenerationStatus;
  step?: string | null;
  reused?: boolean;
  error?: string;
};

function uiState(item: BackgroundTaskItem): JobResumeGenerationState | null {
  if (item.status === "queued" || item.status === "running") {
    return { status: "generating", step: item.step || "Waiting for generation slot…" };
  }
  if (item.status === "completed") return { status: "done", reused: item.reused };
  if (item.status === "failed") return { status: "error", error: item.error || "Résumé generation failed" };
  return null;
}

/** Job Search résumé generation backed by one durable task and one app-wide event stream. */
export function useJobResumeGeneration(jobs: Job[]) {
  const { applier } = useApplier();
  const { tasks, latestTask, startTask, cancelTask, waitForTask } = useBackgroundTasks();
  const resumeTasks = useMemo(() => tasks
    .filter((task) => task.type === "resume_generation"
      && task.progress?.operation === "job_search_resume_generation")
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)), [tasks]);
  const removalTask = latestTask("resume_removal");
  const [resumeStates, setResumeStates] = useState<Record<string, JobResumeGenerationState>>({});
  const [bulkTaskId, setBulkTaskId] = useState<string | null>(null);
  const [removalTaskId, setRemovalTaskId] = useState<string | null>(null);
  const resumeStatesRef = useRef(resumeStates);
  resumeStatesRef.current = resumeStates;

  const uiIdByBackendId = useMemo(
    () => new Map(jobs.map((job) => [job.backendId || job.id, job.id])),
    [jobs],
  );

  useEffect(() => {
    if (!applier?.name || jobs.length === 0) return;
    const ids = [...uiIdByBackendId.keys()];
    let cancelled = false;
    void fetchJobsWithGeneratedResumes(applier.name, ids).then((existing) => {
      if (cancelled || existing.size === 0) return;
      setResumeStates((current) => {
        const next = { ...current };
        for (const backendId of existing) {
          const uiId = uiIdByBackendId.get(backendId);
          if (uiId && !next[uiId]) next[uiId] = { status: "done", reused: true };
        }
        return next;
      });
    });
    return () => { cancelled = true; };
  }, [applier?.name, jobs.length, uiIdByBackendId]);

  useEffect(() => {
		if (!resumeTasks.some((task) => Object.keys(task.progress?.items || {}).length)) return;
    setResumeStates((current) => {
      const next = { ...current };
			// Apply oldest to newest so a later retry always wins, while an older
			// task that finishes after a newer sibling is still represented.
			for (const task of [...resumeTasks].reverse()) {
				for (const [backendId, item] of Object.entries(task.progress?.items || {})) {
					const uiId = uiIdByBackendId.get(backendId);
					if (!uiId) continue;
					const state = uiState(item);
					if (state) next[uiId] = state;
					else if (next[uiId]?.status === "generating") delete next[uiId];
				}
      }
      return next;
    });
  }, [resumeTasks, uiIdByBackendId]);

	const activeResumeTask = resumeTasks.find((task) =>
		["queued", "running", "cancelling"].includes(task.status)
		&& (task.id === bulkTaskId || Number(task.progress.total ?? 0) > 1))
		|| resumeTasks.find((task) => ["queued", "running", "cancelling"].includes(task.status))
		|| null;
  const bulkStopping = activeResumeTask?.status === "cancelling";
  const taskTotal = Number(activeResumeTask?.progress.total ?? 0);
  const bulkRunning = Boolean(activeResumeTask && (activeResumeTask.id === bulkTaskId || taskTotal > 1));
  const taskProgress = activeResumeTask
    ? {
        done: Number(activeResumeTask.progress.completed ?? 0) + Number(activeResumeTask.progress.failed ?? 0),
        total: taskTotal,
        active: Number(activeResumeTask.progress.active ?? 0),
        failed: Number(activeResumeTask.progress.failed ?? 0),
      }
    : null;
  const activeRemovalTask = removalTask && ["queued", "running", "cancelling"].includes(removalTask.status)
    ? removalTask
    : null;
  const removalStopping = activeRemovalTask?.status === "cancelling";
  const bulkRemoving = Boolean(activeRemovalTask || removalTaskId);
  const removalTaskProgress = activeRemovalTask
    ? {
        done: Number(activeRemovalTask.progress.completed ?? 0),
        total: Number(activeRemovalTask.progress.total ?? 0),
        active: Number(activeRemovalTask.progress.active ?? 0),
        phase: (activeRemovalTask.progress.phase || "removing") as JobResumeBulkProgress["phase"],
        failed: Number(activeRemovalTask.progress.failed ?? 0),
      }
    : null;
  const bulkProgress = removalTaskProgress || (bulkRunning ? taskProgress : null);

  const generateForJob = useCallback(async (job: Job): Promise<boolean | null> => {
    if (!applier?.name) {
      toast.error("Select a profile before generating résumés");
      return false;
    }
    if (resumeStatesRef.current[job.id]?.status === "done") return true;
    const backendId = job.backendId || job.id;
    setResumeStates((current) => ({
      ...current,
      [job.id]: { status: "generating", step: "Queueing résumé…" },
    }));
    try {
      const task = await startTask("resume_generation", { jobIds: [backendId], deferPdf: true, origin: "job_search" });
      const finished = await waitForTask(task.id);
      const item = finished.progress.items?.[backendId];
      if (item?.status === "completed") {
        toast.success(`Résumé ${item.reused ? "reused" : "generated"} for "${job.title}"`);
        return true;
      }
      if (finished.status === "cancelled" || item?.status === "cancelled") return null;
      return false;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Résumé generation failed";
      setResumeStates((current) => ({ ...current, [job.id]: { status: "error", error: message } }));
      toast.error(`"${job.title}": ${message}`);
      return false;
    }
  }, [applier?.name, startTask, waitForTask]);

  const generateBulk = useCallback(async (selected: Job[]) => {
    if (bulkRunning || selected.length === 0) return;
    if (!applier?.name) {
      toast.error("Select a profile before generating résumés");
      return;
    }
    const alreadyDone = selected.filter((job) => resumeStatesRef.current[job.id]?.status === "done").length;
    const pending = selected.filter((job) => resumeStatesRef.current[job.id]?.status !== "done");
    if (!pending.length) {
      toast.info(`All ${selected.length} selected job${selected.length === 1 ? " already has" : "s already have"} a résumé`);
      return;
    }
    if (alreadyDone) toast.info(`Skipping ${alreadyDone} job${alreadyDone === 1 ? "" : "s"} with an existing résumé`);
    const backendIds = pending.map((job) => job.backendId || job.id);
    setResumeStates((current) => {
      const next = { ...current };
      for (const job of pending) next[job.id] = { status: "generating", step: "Queueing résumé…" };
      return next;
    });
    try {
      const task = await startTask("resume_generation", { jobIds: backendIds, deferPdf: true, origin: "job_search" });
      setBulkTaskId(task.id);
      const finished = await waitForTask(task.id);
      const completed = Number(finished.progress.completed ?? 0);
      const failed = Number(finished.progress.failed ?? 0);
      const cancelled = Number(finished.progress.cancelled ?? 0);
      if (finished.status === "cancelled") {
        toast.info(`Résumé generation stopped · ${completed} done, ${failed} failed, ${cancelled} skipped`);
      } else if (failed) {
        toast.warning(`Résumés generated for ${completed}/${pending.length} jobs (${failed} failed)`);
      } else {
        toast.success(`Résumés ready for ${completed} job${completed === 1 ? "" : "s"}`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to start résumé generation");
    } finally {
      setBulkTaskId(null);
    }
  }, [applier?.name, bulkRunning, startTask, waitForTask]);

  const cancelBulk = useCallback(() => {
    const task = activeResumeTask;
    if (!task) return;
    void cancelTask(task.id).catch((error) => {
      toast.error(error instanceof Error ? error.message : "Failed to stop résumé generation");
    });
  }, [activeResumeTask, cancelTask]);

  const cancelRemoval = useCallback(() => {
    const task = activeRemovalTask;
    if (!task) return;
    void cancelTask(task.id).catch((error) => {
      toast.error(error instanceof Error ? error.message : "Failed to stop résumé removal");
    });
  }, [activeRemovalTask, cancelTask]);

  const removeBulkResumes = useCallback(async (selected: Job[]) => {
    if (bulkRunning || bulkRemoving || selected.length === 0) return;
    if (!applier?.name) {
      toast.error("Select a profile before removing résumés");
      return;
    }
    const withResumes = selected.filter((job) => resumeStatesRef.current[job.id]?.status === "done");
    if (!withResumes.length) {
      toast.info("None of the selected jobs have a generated résumé");
      return;
    }
    const noun = withResumes.length === 1 ? "résumé" : "résumés";
    if (!confirm(`Remove ${withResumes.length} generated ${noun} for the selected job${withResumes.length === 1 ? "" : "s"}? The jobs stay in your list.`)) return;
    try {
      const task = await startTask("resume_removal", {
        recordIds: withResumes.map((job) => job.backendId || job.id),
      });
      setRemovalTaskId(task.id);
      const finished = await waitForTask(task.id);
      const result = (finished.result || {}) as {
        deletedJobIds?: string[];
        failedJobIds?: string[];
      };
      const deletedJobIds = result.deletedJobIds || [];
      const failedJobIds = result.failedJobIds || [];
      const cleared = new Set(deletedJobIds.map((id) => uiIdByBackendId.get(id)).filter(Boolean));
      setResumeStates((current) => {
        const next = { ...current };
        for (const id of cleared) if (id) delete next[id];
        return next;
      });
      if (finished.status === "cancelled") {
        toast.info(`Résumé removal stopped · ${deletedJobIds.length} removed`);
      } else if (failedJobIds.length) {
        toast.warning(`Removed ${deletedJobIds.length}/${withResumes.length} résumés (${failedJobIds.length} failed)`);
      } else {
        toast.success(`Removed ${withResumes.length} generated ${noun}`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to remove résumés");
    } finally {
      setRemovalTaskId(null);
    }
  }, [applier?.name, bulkRemoving, bulkRunning, startTask, uiIdByBackendId, waitForTask]);

  return {
    resumeStates,
    generateForJob,
    generateBulk,
    cancelBulk,
    cancelRemoval,
    removeBulkResumes,
    bulkRunning,
    bulkStopping,
    bulkRemoving,
    removalStopping,
    bulkProgress,
  };
}
