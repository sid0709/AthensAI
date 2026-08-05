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

const MAX_BULK = 40;

/**
 * Bid Ready Library resume recommend — calls POST /jobs/recommend-resumes
 * and patches local job rows with the returned stacks.
 */
export function useRecommendResumes(onPatchJob?: (job: Job) => void) {
  const { applier } = useApplier();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<RecommendResumeBulkProgress | null>(null);

  const recommendBulk = useCallback(
    async (selected: Job[]) => {
      const name = String(applier?.name || "").trim();
      if (!name) {
        toast.error("Select a profile before recommending resumes.");
        return;
      }
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

      setRunning(true);
      setProgress({ done: 0, total: jobIds.length, succeeded: 0, failed: 0 });
      try {
        const res = await recommendResumesFromLibrary({ applierName: name, jobIds });
        const rows = Array.isArray(res.results) ? res.results : [];
        const byId = new Map(rows.map((row) => [row.jobId, row]));

        for (const job of jobs) {
          const id = String(job.backendId || job.id || "").trim();
          const row = byId.get(id) as RecommendResumeResultRow | undefined;
          if (!row?.ok) continue;
          onPatchJob?.({
            ...job,
            recommendedResumeStack: row.recommendedResumeStack || null,
            recommendedResumeReason: row.recommendedResumeReason || null,
            useCustomizedResume: Boolean(row.useCustomizedResume),
            recommendWarning: row.warning || null,
            recommendedAt: new Date().toISOString(),
          });
        }

        const succeeded = Number(res.succeeded ?? rows.filter((r) => r.ok).length);
        const failed = Number(res.failed ?? rows.filter((r) => !r.ok).length);
        setProgress({
          done: jobIds.length,
          total: jobIds.length,
          succeeded,
          failed,
        });

        if (failed === 0) {
          toast.success(
            succeeded === 1
              ? "Recommended a Library resume for 1 job."
              : `Recommended Library resumes for ${succeeded} jobs.`,
          );
        } else if (succeeded === 0) {
          toast.error("Could not recommend resumes for the selected jobs.");
        } else {
          toast.message(`Recommended ${succeeded} · ${failed} failed.`);
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
