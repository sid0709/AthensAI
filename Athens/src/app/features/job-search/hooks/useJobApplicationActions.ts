import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useApi } from "@/api/useApi";
import { useApplier } from "@/context/applier-context";
import { API_BASE } from "@/lib/api-base";
import { isTransientRequestError } from "@/lib/transient-retry";
import { JOB_STATUS_TO_API } from "../../../api/jobs";
import { mapDocToJob } from "../../../lib/job-adapters";
import type { Job } from "../../../types";
import { runWithConcurrency } from "../lib/run-with-concurrency";

type JobMutationResponse = {
  success?: boolean;
  data?: Record<string, unknown>;
  message?: string;
  viewerStatus?: PipelineStatus | "posted" | "bid-ready" | "bid-completed";
  mutationId?: string;
  statusVersion?: string;
  cacheSync?: "queued";
};

type RequestError = Error & { data?: { error?: string } };

function requestErrorMessage(error: unknown, fallback: string): string {
  const requestError = error as RequestError;
  return requestError?.data?.error || requestError?.message || fallback;
}

type PipelineStatus = "applied" | "scheduled" | "declined";

function newMutationId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function useJobApplicationActions(
  onJobUpdated: (job: Job) => void,
  refreshStatusCounts: () => void | Promise<void>,
) {
  const { get, post } = useApi(API_BASE);
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

  const postMutation = useCallback(async (path: string, body: Record<string, unknown>) => {
    try {
      return (await post(path, body)) as JobMutationResponse;
    } catch (error) {
      if (!isTransientRequestError(error)) throw error;
      return (await post(path, body)) as JobMutationResponse;
    }
  }, [post]);

  const reconcileStatus = useCallback(async (job: Job, expected: Job["status"]) => {
    if (!applier?.name) return false;
    const jobId = job.backendId || job.id;
    try {
      const query = new URLSearchParams({
        applierName: applier.name,
        catalog: job.catalog || "market",
      });
      const result = (await get(`/jobs/${jobId}/viewer-status?${query.toString()}`)) as {
        success?: boolean;
        viewerStatus?: Job["status"];
      };
      return result?.success === true && result.viewerStatus === expected;
    } catch {
      return false;
    }
  }, [applier?.name, get]);

  const applyToJob = useCallback(
    async (job: Job, { openUrl = true }: { openUrl?: boolean } = {}) => {
      const jobId = job.backendId || job.id;
      if (!applier?.name) {
        toast.error("Select a profile before applying");
        return;
      }

      setPending(jobId, true);
      const optimistic = { ...job, status: "applied" as const };
      try {
        if (openUrl && job.applyUrl && job.applyUrl !== "#") {
          window.open(job.applyUrl, "_blank", "noopener,noreferrer");
        }

        onJobUpdated(optimistic);

        const res = await postMutation(`/jobs/${jobId}/apply`, {
          applierName: applier.name,
          catalog: job.catalog || "market",
          mutationId: newMutationId(),
        });

        if (res?.success && res.data) {
          onJobUpdated(mapDocToJob(res.data, applier));
          void refreshStatusCounts();
          if (res.message !== "User has already applied") {
            toast.success("Marked as applied");
          }
        }
      } catch (error) {
        if (await reconcileStatus(job, "applied")) {
          onJobUpdated(optimistic);
          void refreshStatusCounts();
          toast.success("Marked as applied");
          return;
        }
        onJobUpdated(job);
        toast.error("Failed to mark job as applied", {
          description: requestErrorMessage(error, "The server rejected the update."),
        });
      } finally {
        setPending(jobId, false);
      }
    },
    [applier, onJobUpdated, postMutation, reconcileStatus, refreshStatusCounts, setPending],
  );

  const updateJobStatus = useCallback(
    async (job: Job, status: PipelineStatus) => {
      const jobId = job.backendId || job.id;
      if (!applier?.name) {
        toast.error("Select a profile before updating status");
        return;
      }

      setPending(jobId, true);
      const optimistic = { ...job, status };
      onJobUpdated(optimistic);
      try {
        const res = await postMutation(`/jobs/${jobId}/status`, {
          applierName: applier.name,
          status: JOB_STATUS_TO_API[status],
          catalog: job.catalog || "market",
          mutationId: newMutationId(),
        });

        if (res?.success && res.data) {
          onJobUpdated(mapDocToJob(res.data, applier));
          void refreshStatusCounts();
          toast.success(`Marked as ${status}`);
        }
      } catch (error) {
        if (await reconcileStatus(job, status)) {
          onJobUpdated(optimistic);
          void refreshStatusCounts();
          toast.success(`Marked as ${status}`);
          return;
        }
        onJobUpdated(job);
        toast.error("Failed to update job status", {
          description: requestErrorMessage(error, "The server rejected the update."),
        });
      } finally {
        setPending(jobId, false);
      }
    },
    [applier, onJobUpdated, postMutation, reconcileStatus, refreshStatusCounts, setPending],
  );

  const cancelJobStatus = useCallback(
    async (job: Job) => {
      const jobId = job.backendId || job.id;
      if (!applier?.name) {
        toast.error("Select a profile before updating status");
        return;
      }

      setPending(jobId, true);
      const optimisticStatus =
        job.status === "scheduled" || job.status === "declined" ? "applied" : "posted";
      onJobUpdated({ ...job, status: optimisticStatus });
      try {
        let res: JobMutationResponse;

        if (
          job.status === "applied" ||
          job.status === "bid-ready" ||
          job.status === "bid-completed"
        ) {
          if (job.status === "bid-ready" || job.status === "bid-completed") {
            res = await postMutation(`/jobs/${jobId}/bid-status`, {
              applierName: applier.name,
              status: "clear",
              catalog: job.catalog || "market",
              mutationId: newMutationId(),
            });
          } else {
            res = await postMutation(`/jobs/${jobId}/unapply`, {
              applierName: applier.name,
              catalog: job.catalog || "market",
              mutationId: newMutationId(),
            });
          }
        } else if (job.status === "scheduled" || job.status === "declined") {
          res = await postMutation(`/jobs/${jobId}/status`, {
            applierName: applier.name,
            status: JOB_STATUS_TO_API.applied,
            catalog: job.catalog || "market",
            mutationId: newMutationId(),
          });
        } else {
          return;
        }

        if (res?.success && res.data) {
          onJobUpdated(mapDocToJob(res.data, applier));
          void refreshStatusCounts();
          const message =
            job.status === "bid-ready" || job.status === "bid-completed"
              ? "Bid status cleared — back to New"
              : job.status === "applied"
                ? "Application removed"
                : "Moved back to Applied";
          toast.success(message);
        }
      } catch (error) {
        if (await reconcileStatus(job, optimisticStatus)) {
          onJobUpdated({ ...job, status: optimisticStatus });
          void refreshStatusCounts();
          return;
        }
        onJobUpdated(job);
        toast.error("Failed to cancel status", {
          description: requestErrorMessage(error, "The server rejected the update."),
        });
      } finally {
        setPending(jobId, false);
      }
    },
    [applier, onJobUpdated, postMutation, reconcileStatus, refreshStatusCounts, setPending],
  );

  const markBidReady = useCallback(
    async (job: Job) => {
      const jobId = job.backendId || job.id;
      if (!applier?.name) {
        toast.error("Select a profile before updating status");
        return;
      }

      setPending(jobId, true);
      onJobUpdated({ ...job, status: "bid-ready" });
      try {
        const res = await postMutation(`/jobs/${jobId}/bid-status`, {
          applierName: applier.name,
          status: "BidReady",
          catalog: job.catalog || "market",
          mutationId: newMutationId(),
        });

        if (res?.success && res.data) {
          onJobUpdated(mapDocToJob(res.data, applier));
          toast.success("Marked as Bid ready");
          // Counts hit a heavy $facet aggregation — don't block the button on it.
          void refreshStatusCounts();
        }
      } catch (error) {
        if (await reconcileStatus(job, "bid-ready")) {
          onJobUpdated({ ...job, status: "bid-ready" });
          void refreshStatusCounts();
          toast.success("Marked as Bid ready");
          return;
        }
        onJobUpdated(job);
        toast.error("Failed to mark job as Bid ready", {
          description: requestErrorMessage(error, "The server rejected the update."),
        });
      } finally {
        setPending(jobId, false);
      }
    },
    [applier, onJobUpdated, postMutation, reconcileStatus, refreshStatusCounts, setPending],
  );

  const markBidReadyBulk = useCallback(
    async (jobs: Job[]) => {
      if (!applier?.name) {
        toast.error("Select a profile before updating status");
        return;
      }
      const eligible = jobs.filter((job) => job.status === "posted");
      if (!eligible.length) {
        toast.message("Nothing to mark Bid ready", {
          description: "Select New (posted) jobs only.",
        });
        return;
      }

      eligible.forEach((job) => onJobUpdated({ ...job, status: "bid-ready" }));
      const outcomes = await runWithConcurrency(
        eligible,
        async (job) => {
          const jobId = job.backendId || job.id;
          setPending(jobId, true);
          try {
            const res = await postMutation(`/jobs/${jobId}/bid-status`, {
              applierName: applier.name,
              status: "BidReady",
              catalog: job.catalog || "market",
              mutationId: newMutationId(),
            });
            if (res?.success && res.data) {
              onJobUpdated(mapDocToJob(res.data, applier));
              return true;
            }
            return false;
          } catch {
            if (await reconcileStatus(job, "bid-ready")) return true;
            onJobUpdated(job);
            return false;
          } finally {
            setPending(jobId, false);
          }
        },
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
    [applier, onJobUpdated, postMutation, reconcileStatus, refreshStatusCounts, setPending],
  );

  const clearBidReadyBulk = useCallback(
    async (jobs: Job[]) => {
      if (!applier?.name) {
        toast.error("Select a profile before updating status");
        return;
      }
      const eligible = jobs.filter((job) => job.status === "bid-ready");
      if (!eligible.length) {
        toast.message("Nothing to move to New", {
          description: "Select Bid ready jobs only.",
        });
        return;
      }

      eligible.forEach((job) => onJobUpdated({ ...job, status: "posted" }));
      const outcomes = await runWithConcurrency(
        eligible,
        async (job) => {
          const jobId = job.backendId || job.id;
          setPending(jobId, true);
          try {
            const res = await postMutation(`/jobs/${jobId}/bid-status`, {
              applierName: applier.name,
              status: "clear",
              catalog: job.catalog || "market",
              mutationId: newMutationId(),
            });
            if (res?.success && res.data) {
              onJobUpdated(mapDocToJob(res.data, applier));
              return true;
            }
            return false;
          } catch {
            if (await reconcileStatus(job, "posted")) return true;
            onJobUpdated(job);
            return false;
          } finally {
            setPending(jobId, false);
          }
        },
      );
      const ok = outcomes.filter(Boolean).length;
      const failed = outcomes.length - ok;
      if (ok > 0) {
        toast.success(`Moved ${ok} job${ok === 1 ? "" : "s"} back to New`);
      }
      if (failed > 0) {
        toast.error(`Failed on ${failed} job${failed === 1 ? "" : "s"}`);
      }
      void refreshStatusCounts();
    },
    [applier, onJobUpdated, postMutation, reconcileStatus, refreshStatusCounts, setPending],
  );

  return {
    applyToJob,
    updateJobStatus,
    cancelJobStatus,
    markBidReady,
    markBidReadyBulk,
    clearBidReadyBulk,
    isPending,
  };
}
