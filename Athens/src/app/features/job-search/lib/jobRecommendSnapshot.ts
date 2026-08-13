import type { Job, JobStatus } from "../../../types";

const LIBRARY_RECOMMEND_STATUSES = new Set<JobStatus>(["bid-ready", "worker-pool"]);

/** Library recommend / assign is only for Bid ready and Worker pool. */
export function canAssignLibraryResume(status: JobStatus | undefined): boolean {
  return Boolean(status && LIBRARY_RECOMMEND_STATUSES.has(status));
}

/** Durable recommend fields copied from vendor_tasks onto Job Search rows. */
export type JobRecommendSnapshot = Pick<
  Job,
  | "recommendedResumeStack"
  | "recommendedResumeId"
  | "recommendedResumeReason"
  | "useCustomizedResume"
  | "recommendWarning"
  | "recommendedAt"
  | "recommendMode"
>;

export function jobHasRecommendSnapshot(job: Partial<JobRecommendSnapshot>): boolean {
  if (job.recommendedAt) return true;
  if (String(job.recommendedResumeStack || "").trim()) return true;
  if (String(job.recommendedResumeId || "").trim()) return true;
  if (job.useCustomizedResume) return true;
  if (String(job.recommendedResumeReason || "").trim()) return true;
  if (String(job.recommendWarning || "").trim()) return true;
  return false;
}

export function extractRecommendSnapshot(job: Job): JobRecommendSnapshot | null {
  if (!jobHasRecommendSnapshot(job)) return null;
  return {
    recommendedResumeStack: job.recommendedResumeStack ?? null,
    recommendedResumeId: job.recommendedResumeId ?? null,
    recommendedResumeReason: job.recommendedResumeReason ?? null,
    useCustomizedResume: Boolean(job.useCustomizedResume),
    recommendWarning: job.recommendWarning ?? null,
    recommendedAt: job.recommendedAt ?? null,
    recommendMode: job.recommendMode ?? null,
  };
}

/** Prefer server fields; fall back to a prior snapshot when the list omits them. */
export function mergeRecommendSnapshot(job: Job, prior: JobRecommendSnapshot | null | undefined): Job {
  if (!prior) return job;
  if (jobHasRecommendSnapshot(job)) return job;
  return { ...job, ...prior };
}
