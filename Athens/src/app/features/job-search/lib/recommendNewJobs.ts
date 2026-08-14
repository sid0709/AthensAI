import type { RecommendResumeResultRow } from "../../../api/jobs";
import { isExternalJob, type Job } from "../../../types/job";

export type RecommendNewDestination = "bid-ready" | "worker-pool";

export function jobRecordId(job: Pick<Job, "id" | "backendId">): string {
  return String(job.backendId || job.id || "").trim();
}

export function isLibraryRecommendMatch(
  row: RecommendResumeResultRow | undefined,
): boolean {
  if (!row?.ok || row.skipped) return false;
  if (row.useCustomizedResume) return false;
  return Boolean(String(row.recommendedResumeStack || "").trim());
}

export function postedJobsForRecommend(jobs: Job[]): Job[] {
  return jobs.filter(
    (job) => job.status === "posted" && !isExternalJob(job) && jobRecordId(job),
  );
}

export function uniqueCompanies(jobs: Job[]): Job[] {
  const seen = new Set<string>();
  const out: Job[] = [];
  for (const job of jobs) {
    const key = String(job.companyId || "").trim() || jobRecordId(job);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(job);
  }
  return out;
}
