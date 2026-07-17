import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useApplier } from "@/context/applier-context";
import {
  fetchJobDescription,
  fetchJobsWithGeneratedResumes,
  generateJobResumeStream,
} from "../../../api/jobs";
import type { Job } from "../../../types";

/** Max résumés generated concurrently during a bulk run (rate-limit guard). */
const MAX_CONCURRENT_GENERATIONS = 3;

function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name?: string }).name === "AbortError";
}

export type JobResumeGenerationStatus = "generating" | "done" | "error";

export type JobResumeBulkProgress = {
  done: number;
  total: number;
  /** Résumés currently in flight (fetch JD + SSE generation). */
  active: number;
};

export type JobResumeGenerationState = {
  status: JobResumeGenerationStatus;
  /** Live step label while generating (from the SSE stream). */
  step?: string | null;
  /** True when the server reused a previously generated résumé. */
  reused?: boolean;
  error?: string;
};

/**
 * Pre-generate tailored résumés from Job Search via the same Resume Generator
 * pipeline the Agents page uses (`generateJobResumeStream`). Generated résumés
 * are cached server-side per job, so the Agents pipeline reuses them.
 *
 * Jobs that already have a résumé (checked in batch on page load) are marked
 * "done" and skipped by both single and bulk generation.
 */
export function useJobResumeGeneration(jobs: Job[]) {
  const { applier } = useApplier();
  const [resumeStates, setResumeStates] = useState<Record<string, JobResumeGenerationState>>({});
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<JobResumeBulkProgress | null>(null);
  const inflightRef = useRef<Map<string, Promise<boolean | null>>>(new Map());
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const bulkCancelledRef = useRef(false);
  const resumeStatesRef = useRef(resumeStates);
  resumeStatesRef.current = resumeStates;

  const patchState = useCallback((jobId: string, state: JobResumeGenerationState) => {
    setResumeStates((prev) => ({ ...prev, [jobId]: state }));
  }, []);

  // Pre-mark jobs whose résumé was already generated (this session or a prior
  // one) so the UI shows "Ready" and generation skips them.
  useEffect(() => {
    if (!applier?.name || jobs.length === 0) return;
    const applierName = applier.name;
    const idsByBackendId = new Map(jobs.map((job) => [job.backendId || job.id, job.id]));
    let cancelled = false;
    void fetchJobsWithGeneratedResumes(applierName, [...idsByBackendId.keys()]).then((existing) => {
      if (cancelled || existing.size === 0) return;
      setResumeStates((prev) => {
        const next = { ...prev };
        for (const backendId of existing) {
          const jobId = idsByBackendId.get(backendId);
          // Don't clobber an in-flight or failed state from this session.
          if (jobId && !next[jobId]) next[jobId] = { status: "done", reused: true };
        }
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [applier?.name, jobs]);

  const clearGeneratingState = useCallback((jobId: string) => {
    setResumeStates((prev) => {
      if (prev[jobId]?.status !== "generating") return prev;
      const next = { ...prev };
      delete next[jobId];
      return next;
    });
  }, []);

  /** Generate (or reuse) a résumé for one job. Resolves true on success, null when aborted. */
  const generateForJob = useCallback(
    (job: Job, options?: { silent?: boolean }): Promise<boolean | null> => {
      // Already generated (this session or found on the server) — nothing to do.
      if (resumeStatesRef.current[job.id]?.status === "done") return Promise.resolve(true);
      const inflight = inflightRef.current.get(job.id);
      if (inflight) return inflight;

      const promise = (async () => {
        if (!applier?.name) {
          if (!options?.silent) toast.error("Select a profile before generating résumés");
          return false;
        }
        const controller = new AbortController();
        abortControllersRef.current.set(job.id, controller);
        const { signal } = controller;

        const backendId = job.backendId || job.id;
        patchState(job.id, { status: "generating", step: "Fetching job description…" });
        try {
          const jd = await fetchJobDescription(backendId, signal);
          if (!jd) throw new Error("No job description saved for this job");
          const gen = await generateJobResumeStream(
            { applierName: applier.name, jobId: backendId, jobDescription: jd },
            (progress) => {
              if (progress.stepLabel) {
                patchState(job.id, { status: "generating", step: progress.stepLabel });
              }
            },
            signal,
          );
          patchState(job.id, { status: "done", reused: gen.reused });
          if (!options?.silent) {
            toast.success(`Résumé ${gen.reused ? "reused" : "generated"} for "${job.title}"`);
          }
          return true;
        } catch (error) {
          if (isAbortError(error) || signal.aborted) {
            clearGeneratingState(job.id);
            return null;
          }
          const msg = error instanceof Error ? error.message : "Résumé generation failed";
          patchState(job.id, { status: "error", error: msg });
          if (!options?.silent) toast.error(`"${job.title}": ${msg}`);
          return false;
        } finally {
          abortControllersRef.current.delete(job.id);
          inflightRef.current.delete(job.id);
        }
      })();

      inflightRef.current.set(job.id, promise);
      return promise;
    },
    [applier, clearGeneratingState, patchState],
  );

  /** Generate résumés for many jobs, at most MAX_CONCURRENT_GENERATIONS at a time. */
  const generateBulk = useCallback(
    async (selected: Job[]) => {
      if (bulkRunning || selected.length === 0) return;
      if (!applier?.name) {
        toast.error("Select a profile before generating résumés");
        return;
      }

      const alreadyDone = selected.filter((job) => resumeStatesRef.current[job.id]?.status === "done").length;
      const jobs = selected.filter((job) => resumeStatesRef.current[job.id]?.status !== "done");
      if (jobs.length === 0) {
        toast.info(
          `All ${selected.length} selected job${selected.length === 1 ? " already has" : "s already have"} a résumé`,
        );
        return;
      }
      if (alreadyDone > 0) {
        toast.info(`Skipping ${alreadyDone} job${alreadyDone === 1 ? "" : "s"} with an existing résumé`);
      }

      bulkCancelledRef.current = false;
      setBulkRunning(true);
      setBulkProgress({ done: 0, total: jobs.length, active: 0 });

      let succeeded = 0;
      let failed = 0;
      let active = 0;
      let nextIndex = 0;

      const syncProgress = () => {
        setBulkProgress({ done: succeeded + failed, total: jobs.length, active });
      };

      const worker = async () => {
        while (!bulkCancelledRef.current) {
          const index = nextIndex++;
          if (index >= jobs.length) return;
          active++;
          syncProgress();
          const result = await generateForJob(jobs[index], { silent: true });
          active--;
          if (bulkCancelledRef.current) {
            syncProgress();
            return;
          }
          if (result === true) succeeded++;
          else if (result === false) failed++;
          syncProgress();
        }
      };

      try {
        await Promise.all(
          Array.from({ length: Math.min(MAX_CONCURRENT_GENERATIONS, jobs.length) }, worker),
        );
      } finally {
        setBulkRunning(false);
        setBulkProgress(null);
      }

      const skipped = jobs.length - succeeded - failed;
      if (bulkCancelledRef.current) {
        toast.info(`Résumé generation stopped · ${succeeded} done, ${failed} failed, ${skipped} skipped`);
      } else if (failed > 0) {
        toast.warning(`Résumés generated for ${succeeded}/${jobs.length} jobs (${failed} failed)`);
      } else {
        toast.success(`Résumés ready for ${succeeded} job${succeeded === 1 ? "" : "s"}`);
      }
    },
    [applier, bulkRunning, generateForJob],
  );

  /** Stop the bulk run immediately — aborts every in-flight HTTP request. */
  const cancelBulk = useCallback(() => {
    if (!bulkRunning) return;
    bulkCancelledRef.current = true;
    for (const controller of abortControllersRef.current.values()) {
      controller.abort();
    }
    abortControllersRef.current.clear();
    setResumeStates((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [jobId, state] of Object.entries(next)) {
        if (state.status === "generating") {
          delete next[jobId];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    setBulkRunning(false);
    setBulkProgress(null);
  }, [bulkRunning]);

  return {
    resumeStates,
    generateForJob,
    generateBulk,
    cancelBulk,
    bulkRunning,
    bulkProgress,
  };
}
