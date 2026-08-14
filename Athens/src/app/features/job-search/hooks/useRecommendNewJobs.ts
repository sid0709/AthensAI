import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { useApplier } from "@/context/applier-context";
import type { Job } from "../../../types";
import type { RecommendResumeBulkProgress } from "./useRecommendResumes";
import { recommendNewCompany } from "../lib/recommendNewCompany";
import { runWithSlidingPool } from "../lib/run-with-sliding-pool";
import {
  jobRecordId,
  postedJobsForRecommend,
  uniqueCompanies,
  type RecommendNewDestination,
} from "../lib/recommendNewJobs";

export type RecommendNewJobsOptions = {
  destination: RecommendNewDestination;
  applyAllCompanyRoles: boolean;
  autoSwap: boolean;
};

/** Matches backend RECOMMEND_RESUME_CONCURRENCY so this client does not oversubscribe LLM admission. */
const RECOMMEND_NEW_COMPANY_CONCURRENCY = 8;

export function useRecommendNewJobs(
  patchJob: (job: Job) => void,
  markJobsApplied: (ids: string[]) => void,
  refreshStatusCounts: () => void | Promise<void>,
) {
  const { applier } = useApplier();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<RecommendResumeBulkProgress | null>(null);
  const cancelledRef = useRef(false);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
  }, []);

  const recommendNew = useCallback(
    async (selected: Job[], options: RecommendNewJobsOptions) => {
      const name = String(applier?.name || "").trim();
      if (!name || !applier) {
        toast.error("Select a profile before recommending resumes.");
        return;
      }
      const primaries = uniqueCompanies(
        postedJobsForRecommend(selected).length
          ? postedJobsForRecommend(selected)
          : selected.filter((job) => jobRecordId(job)),
      );
      if (!primaries.length) {
        toast.message("Select New jobs to recommend Library resumes.");
        return;
      }

      cancelledRef.current = false;
      const total = primaries.length;
      setRunning(true);
      setProgress({ done: 0, total, succeeded: 0, failed: 0 });

      const tally = { done: 0, moved: 0, skipped: 0, failed: 0 };
      const publish = (label?: string) => {
        setProgress({
          done: tally.done,
          total,
          succeeded: tally.moved,
          failed: tally.failed,
          label,
        });
      };

      try {
        await runWithSlidingPool(
          primaries,
          async (primary) => {
            const outcome = await recommendNewCompany({
              primary,
              applier,
              destination: options.destination,
              applyAllCompanyRoles: options.applyAllCompanyRoles,
              autoSwap: options.autoSwap,
              cancelled: () => cancelledRef.current,
              onProgress: (label) => publish(label),
              patchJob,
              markJobsApplied,
            });
            if (outcome.status === "moved") {
              tally.moved += 1;
              if (outcome.error) {
                toast.error(`Queued ${outcome.company} without marking other roles`, {
                  description: outcome.error,
                });
              }
            } else if (outcome.status === "failed") {
              tally.failed += 1;
              toast.error(`Could not recommend for ${outcome.company}`, {
                description: outcome.error,
              });
            } else {
              tally.skipped += 1;
            }
            tally.done += 1;
            publish();
          },
          RECOMMEND_NEW_COMPANY_CONCURRENCY,
          () => !cancelledRef.current,
        );

        const { moved, skipped, failed } = tally;
        if (failed === 0 && skipped === 0 && moved > 0) {
          toast.success(
            moved === 1
              ? "Moved 1 matching job into the queue with a Library resume."
              : `Moved ${moved} matching jobs into the queue with Library resumes.`,
          );
        } else if (moved === 0 && failed === 0) {
          toast.message(
            skipped === 1
              ? "No Library resume matched — left in New."
              : `No Library resume matched for ${skipped} companies — left in New.`,
          );
        } else if (moved > 0) {
          toast.message(
            `Moved ${moved}${skipped ? ` · ${skipped} unmatched` : ""}${failed ? ` · ${failed} failed` : ""}.`,
          );
        }
        void refreshStatusCounts();
      } finally {
        setRunning(false);
        setTimeout(() => setProgress(null), 1200);
      }
    },
    [applier, markJobsApplied, patchJob, refreshStatusCounts],
  );

  return {
    recommendNew,
    cancelRecommendNew: cancel,
    recommendNewRunning: running,
    recommendNewProgress: progress,
  };
}
