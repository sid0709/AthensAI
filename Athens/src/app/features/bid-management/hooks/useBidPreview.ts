import { useEffect, useState } from "react";
import { useApi } from "@/api/useApi";
import { useApplier } from "@/context/applier-context";
import { API_BASE } from "@/lib/api-base";
import { mapDocToJob } from "../../../lib/job-adapters";
import { fetchJobsWithGeneratedResumes } from "../../../api/jobs";
import type { BidJobDetail, BidResumeInfo } from "../types";

type PreviewState = {
  jobDetail: BidJobDetail | null;
  recommendedResume: BidResumeInfo | null;
  hasGeneratedPdf: boolean;
  loading: boolean;
  error: string | null;
};

const IDLE: PreviewState = {
  jobDetail: null,
  recommendedResume: null,
  hasGeneratedPdf: false,
  loading: false,
  error: null,
};

function labelWorkMode(mode: string | null | undefined): string | null {
  if (!mode) return null;
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}

/**
 * Loads live job description / metadata + generated résumé availability for a bid ticket.
 * Overlay on BidResult snapshot fields in the detail pane.
 */
export function useBidPreview(jobId: string | null, applierNameHint?: string | null) {
  const { get } = useApi(API_BASE);
  const { applier } = useApplier();
  const [state, setState] = useState<PreviewState>(IDLE);
  const applierName = applier?.name || applierNameHint || "";

  useEffect(() => {
    if (!jobId) {
      setState(IDLE);
      return;
    }

    let cancelled = false;
    setState({ ...IDLE, loading: true });

    void (async () => {
      try {
        const jobQs = applierName
          ? `?applierName=${encodeURIComponent(applierName)}`
          : "";
        const [jobRes, generatedIds] = await Promise.all([
          get(`/jobs/${encodeURIComponent(jobId)}${jobQs}`) as Promise<{
            success?: boolean;
            data?: Record<string, unknown>;
            error?: string;
          }>,
          applierName
            ? fetchJobsWithGeneratedResumes(applierName, [jobId])
            : Promise.resolve(new Set<string>()),
        ]);

        if (cancelled) return;

        const mapped =
          jobRes?.success && jobRes.data ? mapDocToJob(jobRes.data, applier) : null;
        const hasGeneratedPdf = generatedIds.has(jobId);

        const jobDetail: BidJobDetail | null = mapped
          ? {
              description: mapped.jobDescription || null,
              postedAt: mapped.postedAt || null,
              postedLabel: mapped.postedAgo || mapped.posted || null,
              salary: mapped.salary || null,
              workMode: labelWorkMode(mapped.workMode),
              seniority: mapped.seniority || null,
              employmentType: mapped.type || null,
              experience: mapped.experience || null,
              skills: mapped.skills || [],
              applicantsText: mapped.applicantsText || null,
            }
          : null;

        const recommendedResume: BidResumeInfo | null = mapped?.bestResumeTechStack
          ? {
              name: `Recommended · ${mapped.bestResumeTechStack}`,
              techStack: mapped.bestResumeTechStack,
              source: "generated",
              fileName: null,
              usedAt: null,
              scorePercent: mapped.scores?.overall ?? null,
            }
          : null;

        setState({
          jobDetail,
          recommendedResume,
          hasGeneratedPdf,
          loading: false,
          error: jobRes?.success === false ? jobRes.error || "Failed to load job" : null,
        });
      } catch (err) {
        if (cancelled) return;
        setState({
          ...IDLE,
          loading: false,
          error: err instanceof Error ? err.message : "Failed to load preview",
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [jobId, applierName, get, applier]);

  return state;
}
