import {
  applyOtherCompanyJobs,
  enqueueJobQueue,
  fetchCompanyPostedJobIds,
  persistRecommendedResume,
  recommendResumesFromLibrary,
  type RecommendResumeResultRow,
} from "../../../api/jobs";
import { mapDocToJob } from "../../../lib/job-adapters";
import type { ApplierAccount } from "@/context/applier-context";
import type { Job } from "../../../types";
import {
  isLibraryRecommendMatch,
  jobRecordId,
  type RecommendNewDestination,
} from "./recommendNewJobs";

export type RecommendNewCompanyOutcome =
  | { status: "moved"; winnerId: string; appliedIds: string[]; company: string; error?: string }
  | { status: "skipped"; company: string }
  | { status: "failed"; company: string; error: string };

export async function recommendNewCompany(input: {
  primary: Job;
  applier: ApplierAccount;
  destination: RecommendNewDestination;
  applyAllCompanyRoles: boolean;
  autoSwap: boolean;
  cancelled: () => boolean;
  onProgress?: (label: string) => void;
  patchJob: (job: Job) => void;
  markJobsApplied: (ids: string[]) => void;
}): Promise<RecommendNewCompanyOutcome> {
  const company = input.primary.company || "company";
  const keepId = jobRecordId(input.primary);
  const companyId = String(input.primary.companyId || "").trim();
  const applierName = String(input.applier.name || "").trim();

  try {
    const candidateIds = await resolveCandidates(input, keepId, companyId, applierName);
    if (!candidateIds.length) return { status: "skipped", company };

    let winner: { jobId: string; row: RecommendResumeResultRow } | null = null;
    for (let i = 0; i < candidateIds.length; i += 1) {
      if (input.cancelled()) return { status: "skipped", company };
      input.onProgress?.(`${company} · ${i + 1}/${candidateIds.length}`);
      const jobId = candidateIds[i];
      const row = await analyzePostedJob(applierName, jobId);
      if (isLibraryRecommendMatch(row) && row) {
        winner = { jobId, row };
        break;
      }
    }

    if (!winner) return { status: "skipped", company };
    if (input.cancelled()) return { status: "skipped", company };

    input.onProgress?.(`${company} · moving`);
    const queued = await enqueueJobQueue({
      jobId: winner.jobId,
      applierName,
      destination: input.destination,
      catalog: input.primary.catalog,
    });
    if (!queued?.success) {
      return {
        status: "failed",
        company,
        error: queued?.error || "Could not move matching job into the queue.",
      };
    }

    input.onProgress?.(`${company} · saving recommendation`);
    const stack = String(winner.row.recommendedResumeStack || "").trim();
    const mapped = queued.data
      ? mapDocToJob(queued.data, input.applier)
      : {
          ...input.primary,
          id: winner.jobId,
          backendId: winner.jobId,
          status: input.destination,
        };

    let persisted: Awaited<ReturnType<typeof persistRecommendedResume>>;
    try {
      persisted = await persistRecommendedResume({
        applierName,
        jobId: winner.jobId,
        recommendedResumeStack: stack,
        recommendedResumeReason: winner.row.recommendedResumeReason,
        warning: winner.row.warning,
        mode: winner.row.mode === "heuristic" ? "heuristic" : "llm",
      });
    } catch (err) {
      input.patchJob({ ...mapped, status: input.destination });
      return {
        status: "failed",
        company,
        error:
          err instanceof Error
            ? `${err.message} Job is in the queue — retry Recommend there.`
            : "Saved to the queue without a recommendation — retry Recommend there.",
      };
    }

    const recommendPatch = {
      recommendedResumeStack: persisted.recommendedResumeStack || stack,
      recommendedResumeId: persisted.recommendedResumeId || null,
      recommendedResumeReason:
        persisted.recommendedResumeReason || winner.row.recommendedResumeReason || null,
      useCustomizedResume: false,
      recommendWarning: persisted.recommendWarning || winner.row.warning || null,
      recommendedAt: persisted.recommendedAt || new Date().toISOString(),
      recommendMode:
        persisted.recommendMode === "heuristic" ? "heuristic" as const : "llm" as const,
    };
    input.patchJob({ ...mapped, ...recommendPatch, status: input.destination });

    let appliedIds: string[] = [];
    if (input.applyAllCompanyRoles) {
      input.onProgress?.(`${company} · marking other roles applied`);
      try {
        const applied = await applyOtherCompanyJobs(
          companyId || keepId,
          [winner.jobId],
          applierName,
        );
        appliedIds = applied.appliedIds || [];
        if (appliedIds.length) input.markJobsApplied(appliedIds);
      } catch (err) {
        return {
          status: "moved",
          winnerId: winner.jobId,
          appliedIds,
          company,
          error:
            err instanceof Error
              ? err.message
              : "Matching job queued; other company roles were not marked applied.",
        };
      }
    }

    return { status: "moved", winnerId: winner.jobId, appliedIds, company };
  } catch (err) {
    return {
      status: "failed",
      company,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function resolveCandidates(
  input: {
    applyAllCompanyRoles: boolean;
    autoSwap: boolean;
  },
  keepId: string,
  companyId: string,
  applierName: string,
): Promise<string[]> {
  if (!input.applyAllCompanyRoles || !input.autoSwap) return keepId ? [keepId] : [];
  const res = await fetchCompanyPostedJobIds({
    applierName,
    companyId: companyId || keepId,
    keepJobId: keepId,
  });
  const ids = (res.jobIds || []).map((id) => String(id || "").trim()).filter(Boolean);
  return ids.length ? ids : keepId ? [keepId] : [];
}

async function analyzePostedJob(
  applierName: string,
  jobId: string,
): Promise<RecommendResumeResultRow | undefined> {
  const res = await recommendResumesFromLibrary({
    applierName,
    jobIds: [jobId],
    persist: false,
    replaceExisting: true,
  });
  return (res.results || []).find((row) => row.jobId === jobId) ?? res.results?.[0];
}
