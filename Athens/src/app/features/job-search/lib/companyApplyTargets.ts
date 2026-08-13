import { isExternalJob, type CompanyJobGroup, type Job, type JobStatus } from "../../../types/job";

const APPLYABLE_STATUSES = new Set<JobStatus>(["posted", "bid-ready", "worker-pool", "bid-completed"]);

export const APPLY_ALL_COMPANY_ROLES_KEY = "athens-apply-all-company-roles";

export function readApplyAllCompanyRoles(): boolean {
  try {
    return localStorage.getItem(APPLY_ALL_COMPANY_ROLES_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeApplyAllCompanyRoles(enabled: boolean): void {
  try {
    localStorage.setItem(APPLY_ALL_COMPANY_ROLES_KEY, enabled ? "1" : "0");
  } catch {
    /* ignore quota / private mode */
  }
}

function jobRecordId(job: Pick<Job, "id" | "backendId">): string {
  return job.backendId || job.id;
}

export function canMarkJobApplied(job: Job): boolean {
  return APPLYABLE_STATUSES.has(job.status) && !isExternalJob(job);
}

export function companyApplyTargets(job: Job, group: CompanyJobGroup | undefined): {
  siblings: Job[];
  unloadedIds: string[];
} {
  const primaryId = jobRecordId(job);
  const loaded = group?.jobs?.length ? group.jobs : [job];
  const siblings = loaded.filter((candidate) => {
    if (jobRecordId(candidate) === primaryId) return false;
    return canMarkJobApplied(candidate);
  });

  const knownIds = new Set(loaded.map(jobRecordId));
  knownIds.add(primaryId);

  const unloadedIds = (group?.matchingJobIds ?? []).filter((id) => id && !knownIds.has(id));

  return { siblings, unloadedIds };
}
