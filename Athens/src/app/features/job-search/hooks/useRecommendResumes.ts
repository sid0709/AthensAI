import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useApplier } from "@/context/applier-context";
import {
  recommendResumesFromLibrary,
  type RecommendResumeResultRow,
} from "../../../api/jobs";
import { canAssignLibraryResume, jobHasRecommendSnapshot } from "../lib/jobRecommendSnapshot";
import type { Job } from "../../../types";

export type RecommendResumeBulkProgress = {
  done: number;
  total: number;
  succeeded: number;
  failed: number;
};

export type RecommendResumesOptions = {
  /** When false, skip LLM for jobs that already have a recommendation. Default true. */
  replaceExisting?: boolean;
};

/** Max jobs per recommend-resumes request (matches backend ArrayMaxSize). */
const MAX_BULK = 40;

/** True when the job already has a Library (or customized) recommendation. */
export function jobHasResumeRecommendation(job: Job): boolean {
  return jobHasRecommendSnapshot(job);
}

function chunkJobs<T>(items: T[], size: number): T[][] {
  if (size <= 0 || items.length === 0) return items.length ? [items] : [];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * Library resume recommend — calls POST /jobs/recommend-resumes
 * (chunked to MAX_BULK) and patches local job rows with the returned stacks.
 */
export function useRecommendResumes(onPatchJob?: (job: Job) => void) {
  const { applier } = useApplier();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<RecommendResumeBulkProgress | null>(null);

  const recommendBulk = useCallback(
    async (selected: Job[], options?: RecommendResumesOptions) => {
      const name = String(applier?.name || "").trim();
      if (!name) {
        toast.error("Select a profile before recommending resumes.");
        return;
      }
      const replaceExisting = options?.replaceExisting !== false;
      const jobs = selected.filter((job) =>
        Boolean(String(job.backendId || job.id || "").trim()),
      );
      const eligible = jobs.filter((job) => canAssignLibraryResume(job.status));
      if (!eligible.length) {
        toast.message("Recommend is only available for Bid ready or Worker pool jobs.");
        return;
      }

      const toRun = replaceExisting
        ? eligible
        : eligible.filter((job) => !jobHasResumeRecommendation(job));
      const skippedExisting = eligible.length - toRun.length;
      if (!toRun.length) {
        toast.message("All selected jobs already have recommendations — nothing to run.");
        return;
      }

      const total = toRun.length;
      setRunning(true);
      setProgress({ done: 0, total, succeeded: 0, failed: 0 });

      let succeeded = 0;
      let skipped = skippedExisting;
      let failed = 0;
      let done = 0;

      try {
        for (const batch of chunkJobs(toRun, MAX_BULK)) {
          const jobIds = batch.map((job) =>
            String(job.backendId || job.id || "").trim(),
          );
          const res = await recommendResumesFromLibrary({
            applierName: name,
            jobIds,
            replaceExisting,
          });
          const rows = Array.isArray(res.results) ? res.results : [];
          const byId = new Map(rows.map((row) => [row.jobId, row]));

          for (const job of batch) {
            const id = String(job.backendId || job.id || "").trim();
            const row = byId.get(id) as RecommendResumeResultRow | undefined;
            if (!row?.ok || row.skipped) continue;
            onPatchJob?.({
              ...job,
              recommendedResumeStack: row.recommendedResumeStack || null,
              recommendedResumeId: row.recommendedResumeId || null,
              recommendedResumeReason: row.recommendedResumeReason || null,
              useCustomizedResume: Boolean(row.useCustomizedResume),
              recommendWarning: row.warning || null,
              recommendedAt: new Date().toISOString(),
              recommendMode:
                row.mode === "llm" || row.mode === "heuristic" || row.mode === "manual"
                  ? row.mode
                  : job.recommendMode ?? null,
            });
          }

          succeeded += Number(
            res.succeeded ?? rows.filter((r) => r.ok && !r.skipped).length,
          );
          skipped += Number(
            res.skipped ?? rows.filter((r) => r.ok && r.skipped).length,
          );
          failed += Number(res.failed ?? rows.filter((r) => !r.ok).length);
          done += batch.length;
          setProgress({ done, total, succeeded, failed });
        }

        if (failed === 0 && skipped === 0) {
          toast.success(
            succeeded === 1
              ? "Recommended a Library resume for 1 job."
              : `Recommended Library resumes for ${succeeded} jobs.`,
          );
        } else if (failed === 0 && succeeded === 0 && skipped > 0) {
          toast.message(
            skipped === 1
              ? "Skipped 1 job that already had a recommendation."
              : `Skipped ${skipped} jobs that already had recommendations.`,
          );
        } else if (failed === 0) {
          toast.success(
            `Recommended ${succeeded} · skipped ${skipped} already recommended.`,
          );
        } else if (succeeded === 0 && skipped === 0) {
          toast.error("Could not recommend resumes for the selected jobs.");
        } else {
          toast.message(
            `Recommended ${succeeded}${skipped ? ` · skipped ${skipped}` : ""} · ${failed} failed.`,
          );
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Recommend resumes failed.");
      } finally {
        setRunning(false);
        setTimeout(() => setProgress(null), 1200);
      }
    },
    [applier?.name, onPatchJob],
  );

  return { recommendBulk, recommendRunning: running, recommendProgress: progress };
}
