import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useApi } from "@/api/useApi";
import { useApplier } from "@/context/applier-context";
import { API_BASE } from "@/lib/api-base";
import { JOB_STATUS_TO_API } from "../../../api/jobs";
import { mapDocToJob } from "../../../lib/job-adapters";
import type { Job } from "../../../types";
import { isExternalJob } from "../../../types/job";

type JobMutationResponse = {
  success?: boolean;
  data?: Record<string, unknown>;
  message?: string;
};

type PipelineStatus = "applied" | "scheduled" | "declined";

export function useJobApplicationActions(
  onJobUpdated: (job: Job) => void,
  refreshStatusCounts: () => void | Promise<void>,
) {
  const { post } = useApi(API_BASE);
  const { applier } = useApplier();
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

  const setPending = useCallback((jobId: string, pending: boolean) => {
    setPendingIds((prev) => {
      const next = new Set(prev);
      if (pending) next.add(jobId);
      else next.delete(jobId);
      return next;
    });
  }, []);

  const isPending = useCallback((jobId: string) => pendingIds.has(jobId), [pendingIds]);

  const applyToJob = useCallback(
    async (job: Job, { openUrl = true }: { openUrl?: boolean } = {}) => {
      const jobId = job.backendId || job.id;
      if (!applier?.name) {
        toast.error("Select a profile before applying");
        return;
      }

      setPending(jobId, true);
      try {
        if (openUrl && job.applyUrl && job.applyUrl !== "#") {
          window.open(job.applyUrl, "_blank", "noopener,noreferrer");
        }

        if (isExternalJob(job)) {
          return;
        }

        const res = (await post(`/jobs/${jobId}/apply`, {
          applierName: applier.name,
        })) as JobMutationResponse;

        if (res?.success && res.data) {
          onJobUpdated(mapDocToJob(res.data, applier));
          await refreshStatusCounts();
          if (res.message !== "User has already applied") {
            toast.success("Marked as applied");
          }
        }
      } catch {
        toast.error("Failed to mark job as applied");
      } finally {
        setPending(jobId, false);
      }
    },
    [applier, onJobUpdated, post, refreshStatusCounts, setPending],
  );

  const updateJobStatus = useCallback(
    async (job: Job, status: PipelineStatus) => {
      if (isExternalJob(job)) return;
      const jobId = job.backendId || job.id;
      if (!applier?.name) {
        toast.error("Select a profile before updating status");
        return;
      }

      setPending(jobId, true);
      try {
        const res = (await post(`/jobs/${jobId}/status`, {
          applierName: applier.name,
          status: JOB_STATUS_TO_API[status],
        })) as JobMutationResponse;

        if (res?.success && res.data) {
          onJobUpdated(mapDocToJob(res.data, applier));
          await refreshStatusCounts();
          toast.success(`Marked as ${status}`);
        }
      } catch {
        toast.error("Failed to update job status");
      } finally {
        setPending(jobId, false);
      }
    },
    [applier, onJobUpdated, post, refreshStatusCounts, setPending],
  );

  const cancelJobStatus = useCallback(
    async (job: Job) => {
      if (isExternalJob(job)) return;
      const jobId = job.backendId || job.id;
      if (!applier?.name) {
        toast.error("Select a profile before updating status");
        return;
      }

      setPending(jobId, true);
      try {
        let res: JobMutationResponse;

        if (
          job.status === "applied" ||
          job.status === "bid-ready" ||
          job.status === "bid-completed"
        ) {
          if (job.status === "bid-ready" || job.status === "bid-completed") {
            res = (await post(`/jobs/${jobId}/bid-status`, {
              applierName: applier.name,
              status: "clear",
            })) as JobMutationResponse;
          } else {
            res = (await post(`/jobs/${jobId}/unapply`, {
              applierName: applier.name,
            })) as JobMutationResponse;
          }
        } else if (job.status === "scheduled" || job.status === "declined") {
          res = (await post(`/jobs/${jobId}/status`, {
            applierName: applier.name,
            status: JOB_STATUS_TO_API.applied,
          })) as JobMutationResponse;
        } else {
          return;
        }

        if (res?.success && res.data) {
          onJobUpdated(mapDocToJob(res.data, applier));
          await refreshStatusCounts();
          const message =
            job.status === "bid-ready" || job.status === "bid-completed"
              ? "Bid status cleared — back to New"
              : job.status === "applied"
                ? "Application removed"
                : "Moved back to Applied";
          toast.success(message);
        }
      } catch {
        toast.error("Failed to cancel status");
      } finally {
        setPending(jobId, false);
      }
    },
    [applier, onJobUpdated, post, refreshStatusCounts, setPending],
  );

  const markBidReady = useCallback(
    async (job: Job) => {
      if (isExternalJob(job)) return;
      const jobId = job.backendId || job.id;
      if (!applier?.name) {
        toast.error("Select a profile before updating status");
        return;
      }

      setPending(jobId, true);
      try {
        const res = (await post(`/jobs/${jobId}/bid-status`, {
          applierName: applier.name,
          status: "BidReady",
        })) as JobMutationResponse;

        if (res?.success && res.data) {
          onJobUpdated(mapDocToJob(res.data, applier));
          toast.success("Marked as Bid ready");
          // Counts hit a heavy $facet aggregation — don't block the button on it.
          void refreshStatusCounts();
        }
      } catch {
        toast.error("Failed to mark job as Bid ready");
      } finally {
        setPending(jobId, false);
      }
    },
    [applier, onJobUpdated, post, refreshStatusCounts, setPending],
  );

  const markBidReadyBulk = useCallback(
    async (jobs: Job[]) => {
      if (!applier?.name) {
        toast.error("Select a profile before updating status");
        return;
      }
      const eligible = jobs.filter((job) => !isExternalJob(job) && job.status === "posted");
      if (!eligible.length) {
        toast.message("Nothing to mark Bid ready", {
          description: "Select New (posted) jobs only.",
        });
        return;
      }

      // Parallelize — sequential POSTs made bulk Bid ready feel multi-second.
      const outcomes = await Promise.all(
        eligible.map(async (job) => {
          const jobId = job.backendId || job.id;
          setPending(jobId, true);
          try {
            const res = (await post(`/jobs/${jobId}/bid-status`, {
              applierName: applier.name,
              status: "BidReady",
            })) as JobMutationResponse;
            if (res?.success && res.data) {
              onJobUpdated(mapDocToJob(res.data, applier));
              return true;
            }
            return false;
          } catch {
            return false;
          } finally {
            setPending(jobId, false);
          }
        }),
      );
      const ok = outcomes.filter(Boolean).length;
      const failed = outcomes.length - ok;
      if (ok > 0) {
        toast.success(`Marked ${ok} job${ok === 1 ? "" : "s"} as Bid ready`);
      }
      if (failed > 0) {
        toast.error(`Failed on ${failed} job${failed === 1 ? "" : "s"}`);
      }
      void refreshStatusCounts();
    },
    [applier, onJobUpdated, post, refreshStatusCounts, setPending],
  );

  return {
    applyToJob,
    updateJobStatus,
    cancelJobStatus,
    markBidReady,
    markBidReadyBulk,
    isPending,
  };
}
