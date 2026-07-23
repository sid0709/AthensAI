import { useCallback, useEffect, useRef, useState } from "react";
import { useApi } from "@/api/useApi";
import { useApplier } from "@/context/applier-context";
import { API_BASE } from "@/lib/api-base";
import { mapDocToJob, mergeListJobMetadata } from "../../../lib/job-adapters";
import type { Job } from "../../../types";

type DetailResponse = {
  success?: boolean;
  data?: Record<string, unknown>;
  error?: string;
};

export function useJobDetail(job: Job | null, enabled: boolean) {
  const { get } = useApi(API_BASE);
  const { applier } = useApplier();
  const [detail, setDetail] = useState<Job | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cacheRef = useRef<Map<string, Job>>(new Map());

  const jobId = job?.backendId || job?.id || "";

  const fetchDetail = useCallback(async () => {
    if (!jobId || !job) return;
    const cached = cacheRef.current.get(jobId);
    if (cached?.jobDescription && cached.jobDescription.length > 120) {
      setDetail(cached);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const qs = applier?.name
        ? `?applierName=${encodeURIComponent(applier.name)}`
        : "";
      const res = (await get(`/jobs/${jobId}${qs}`)) as DetailResponse;
      if (res?.success && res.data) {
        const mapped = mergeListJobMetadata(job, mapDocToJob(res.data, applier));
        cacheRef.current.set(jobId, mapped);
        setDetail(mapped);
      } else {
        setError(res?.error || "Failed to load job details");
        setDetail(job);
      }
    } catch {
      setError("Failed to load job details");
      setDetail(job);
    } finally {
      setLoading(false);
    }
  }, [get, jobId, applier, job]);

  useEffect(() => {
    if (!enabled || !jobId) {
      setDetail(null);
      setError(null);
      return;
    }
    void fetchDetail();
  }, [enabled, jobId, fetchDetail]);

  const displayJob = detail ?? job;

  return { displayJob, loading, error, refetch: fetchDetail };
}
