import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useApplier } from "@/context/applier-context";
import {
  deleteJobsGeneratedResumes,
  fetchJobDescription,
  fetchJobsWithGeneratedResumes,
  generateJobResumeStream,
} from "../../../api/jobs";
import type { Job } from "../../../types";

/** Max résumés generated concurrently during a bulk run (matches server per-user default). */
const MAX_CONCURRENT_GENERATIONS = 12;

/** Same heuristic as job detail — skip a round-trip when the list already has the JD. */
const CACHED_JD_MIN_CHARS = 120;

function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name?: string }).name === "AbortError";
}

export type JobResumeGenerationStatus = "generating" | "done" | "error";

export type JobResumeBulkProgress = {
  done: number;
  total: number;
  /** Résumés currently in flight (fetch JD + SSE generation). */
  active: number;
  /** Fractional jobs from in-flight SSE steps (0..active) — drives the progress bar. */
  partial?: number;
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
  const [bulkRemoving, setBulkRemoving] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<JobResumeBulkProgress | null>(null);
  const inflightRef = useRef<Map<string, Promise<boolean | null>>>(new Map());
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const bulkCancelledRef = useRef(false);
  const resumeStatesRef = useRef(resumeStates);
  resumeStatesRef.current = resumeStates;
  /** Per-job fractional progress (0..1) while a bulk run is active. */
  const bulkJobFractionRef = useRef<Map<string, number>>(new Map());

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
    (
      job: Job,
      options?: {
        silent?: boolean;
        onStepProgress?: (fraction: number) => void;
      },
    ): Promise<boolean | null> => {
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
          const cachedJd = String(job.jobDescription || "").trim();
          const jd =
            cachedJd.length > CACHED_JD_MIN_CHARS
              ? cachedJd
              : await fetchJobDescription(backendId, signal, applier.name);
          if (!jd) throw new Error("No job description saved for this job");
          if (cachedJd.length > CACHED_JD_MIN_CHARS) {
            options?.onStepProgress?.(0.05);
          }

          const gen = await generateJobResumeStream(
            {
              applierName: applier.name,
              jobId: backendId,
              jobDescription: jd,
              deferPdf: true,
            },
            (progress) => {
              if (progress.stepLabel) {
                patchState(job.id, { status: "generating", step: progress.stepLabel });
              }
              if (progress.phase === "reused") {
                options?.onStepProgress?.(0.9);
                return;
              }
              const total = progress.stepTotal && progress.stepTotal > 0 ? progress.stepTotal : 0;
              const index = progress.stepIndex && progress.stepIndex > 0 ? progress.stepIndex : 0;
              if (total > 0 && index > 0) {
                // step-done at i/total → i/total; step-start at i → (i-1)/total + small bump
                const base =
                  progress.phase === "step-done" ? index / total : Math.max(0, index - 1) / total;
                const bump = progress.phase === "step-start" ? 0.05 / total : 0;
                options?.onStepProgress?.(Math.min(0.95, base + bump));
              }
            },
            signal,
          );
          options?.onStepProgress?.(1);
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
      bulkJobFractionRef.current = new Map();
      setBulkRunning(true);
      setBulkProgress({ done: 0, total: jobs.length, active: 0, partial: 0 });

      let succeeded = 0;
      let failed = 0;
      let active = 0;
      let nextIndex = 0;

      const syncProgress = () => {
        let partial = 0;
        for (const frac of bulkJobFractionRef.current.values()) {
          partial += Math.min(1, Math.max(0, frac));
        }
        setBulkProgress({
          done: succeeded + failed,
          total: jobs.length,
          active,
          partial,
        });
      };

      const worker = async () => {
        while (!bulkCancelledRef.current) {
          const index = nextIndex++;
          if (index >= jobs.length) return;
          const job = jobs[index];
          active++;
          bulkJobFractionRef.current.set(job.id, 0);
          syncProgress();
          const result = await generateForJob(job, {
            silent: true,
            onStepProgress: (fraction) => {
              if (bulkCancelledRef.current) return;
              const prev = bulkJobFractionRef.current.get(job.id) ?? 0;
              bulkJobFractionRef.current.set(job.id, Math.max(prev, fraction));
              syncProgress();
            },
          });
          bulkJobFractionRef.current.delete(job.id);
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
        bulkJobFractionRef.current.clear();
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
    bulkJobFractionRef.current.clear();
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

  /** Remove generated résumés for selected jobs (jobs themselves are kept). */
  const removeBulkResumes = useCallback(
    async (selected: Job[]) => {
      if (bulkRunning || bulkRemoving || selected.length === 0) return;
      if (!applier?.name) {
        toast.error("Select a profile before removing résumés");
        return;
      }

      const withResumes = selected.filter((job) => resumeStatesRef.current[job.id]?.status === "done");
      if (withResumes.length === 0) {
        toast.info("None of the selected jobs have a generated résumé");
        return;
      }

      const noun = withResumes.length === 1 ? "résumé" : "résumés";
      if (
        !confirm(
          `Remove ${withResumes.length} generated ${noun} for the selected job${withResumes.length === 1 ? "" : "s"}? The jobs stay in your list.`,
        )
      ) {
        return;
      }

      setBulkRemoving(true);
      try {
        await deleteJobsGeneratedResumes(
          applier.name,
          withResumes.map((job) => job.backendId || job.id),
        );
        const clearedUiIds = new Set(withResumes.map((job) => job.id));
        setResumeStates((prev) => {
          const next = { ...prev };
          for (const jobId of clearedUiIds) delete next[jobId];
          return next;
        });
        toast.success(
          `Removed ${withResumes.length} generated ${withResumes.length === 1 ? "résumé" : "résumés"}`,
        );
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to remove résumés");
      } finally {
        setBulkRemoving(false);
      }
    },
    [applier, bulkRemoving, bulkRunning],
  );

  return {
    resumeStates,
    generateForJob,
    generateBulk,
    cancelBulk,
    removeBulkResumes,
    bulkRunning,
    bulkRemoving,
    bulkProgress,
  };
}
