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

export function companyGroupForJob(
  job: Job,
  groups: CompanyJobGroup[],
): CompanyJobGroup | undefined {
  const companyId = String(job.companyId || "").trim();
  const keepId = jobRecordId(job);
  return (
    groups.find((group) => companyId && group.companyId === companyId) ||
    groups.find((group) =>
      group.jobs.some(
        (candidate) =>
          candidate.id === job.id || jobRecordId(candidate) === keepId,
      ),
    )
  );
}

export function canMarkJobApplied(job: Job): boolean {
  return APPLYABLE_STATUSES.has(job.status) && !isExternalJob(job);
}

export function companyApplyTargets(job: Job, group: CompanyJobGroup | undefined): {
  siblings: Job[];
  unloadedIds: string[];
} {
  return companyApplyTargetsForPrimaries([job], group ? [group] : []);
}

/** Other company roles to mark applied, excluding every primary (selected) job. */
export function companyApplyTargetsForPrimaries(
  primaries: Job[],
  groups: CompanyJobGroup[],
): {
  siblings: Job[];
  unloadedIds: string[];
} {
  const keepIds = new Set(primaries.map(jobRecordId).filter(Boolean));
  const siblings: Job[] = [];
  const siblingIds = new Set<string>();
  const unloadedIds: string[] = [];
  const unloadedSeen = new Set<string>();
  const seenCompanies = new Set<string>();

  for (const job of primaries) {
    const group = companyGroupForJob(job, groups);
    const companyId = String(group?.companyId || job.companyId || "").trim();
    if (!companyId || seenCompanies.has(companyId)) continue;
    seenCompanies.add(companyId);
    const loaded = group?.jobs?.length ? group.jobs : [job];
    for (const candidate of loaded) {
      const id = jobRecordId(candidate);
      if (!id || keepIds.has(id) || siblingIds.has(id)) continue;
      if (!canMarkJobApplied(candidate)) continue;
      siblings.push(candidate);
      siblingIds.add(id);
    }

    const knownIds = new Set(loaded.map(jobRecordId));
    for (const id of keepIds) knownIds.add(id);
    for (const id of siblingIds) knownIds.add(id);
    for (const id of group?.matchingJobIds ?? []) {
      if (!id || knownIds.has(id) || unloadedSeen.has(id)) continue;
      unloadedIds.push(id);
      unloadedSeen.add(id);
    }
  }

  return { siblings, unloadedIds };
}
