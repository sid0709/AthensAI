import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useApplier } from "@/context/applier-context";
import {
  recommendResumesFromLibrary,
  type RecommendResumeResultRow,
} from "../../../api/jobs";
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

const MAX_BULK = 40;

/** True when the job already has a Library (or customized) recommendation. */
export function jobHasResumeRecommendation(job: Job): boolean {
  if (job.recommendedAt) return true;
  if (String(job.recommendedResumeStack || "").trim()) return true;
  if (job.useCustomizedResume) return true;
  return false;
}

/**
 * Bid Ready Library resume recommend — calls POST /jobs/recommend-resumes
 * and patches local job rows with the returned stacks.
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
      const jobs = selected.slice(0, MAX_BULK);
      const jobIds = jobs
        .map((job) => String(job.backendId || job.id || "").trim())
        .filter(Boolean);
      if (!jobIds.length) {
        toast.error("Select at least one job.");
        return;
      }
      if (selected.length > MAX_BULK) {
        toast.message(`Recommending the first ${MAX_BULK} selected jobs.`);
      }

      if (!replaceExisting) {
        const needsAi = jobs.filter((job) => !jobHasResumeRecommendation(job));
        if (!needsAi.length) {
          toast.message("All selected jobs already have recommendations — nothing to run.");
          return;
        }
      }

      setRunning(true);
      setProgress({ done: 0, total: jobIds.length, succeeded: 0, failed: 0 });
      try {
        const res = await recommendResumesFromLibrary({
          applierName: name,
          jobIds,
          replaceExisting,
        });
        const rows = Array.isArray(res.results) ? res.results : [];
        const byId = new Map(rows.map((row) => [row.jobId, row]));

        for (const job of jobs) {
          const id = String(job.backendId || job.id || "").trim();
          const row = byId.get(id) as RecommendResumeResultRow | undefined;
          if (!row?.ok || row.skipped) continue;
          onPatchJob?.({
            ...job,
            recommendedResumeStack: row.recommendedResumeStack || null,
            recommendedResumeReason: row.recommendedResumeReason || null,
            useCustomizedResume: Boolean(row.useCustomizedResume),
            recommendWarning: row.warning || null,
            recommendedAt: new Date().toISOString(),
          });
        }

        const succeeded = Number(res.succeeded ?? rows.filter((r) => r.ok && !r.skipped).length);
        const skipped = Number(res.skipped ?? rows.filter((r) => r.ok && r.skipped).length);
        const failed = Number(res.failed ?? rows.filter((r) => !r.ok).length);
        setProgress({
          done: jobIds.length,
          total: jobIds.length,
          succeeded,
          failed,
        });

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
