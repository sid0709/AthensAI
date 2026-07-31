import type { CompanyJobGroup, Job } from "../../../types";

export function mergeCompanyMembers(
  groups: CompanyJobGroup[],
  companyId: string,
  loadedJobs: Array<{ job: Job; order: number }>,
  nextMemberOffset: number | null,
): CompanyJobGroup[] {
  return groups.map((group) => {
    if (group.companyId !== companyId) return group;
    const memberOrder = { ...group.memberOrder };
    group.jobs.forEach((job, index) => {
      if (memberOrder[job.id] === undefined) memberOrder[job.id] = index;
    });
    const seen = new Set(group.jobs.map((job) => job.id));
    const uniqueLoadedJobs = loadedJobs.flatMap(({ job, order }) => {
      memberOrder[job.id] = order;
      if (seen.has(job.id)) return [];
      seen.add(job.id);
      return [job];
    });
    const jobs = [...group.jobs, ...uniqueLoadedJobs].sort((left, right) => {
      const leftOrder = memberOrder[left.id] ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = memberOrder[right.id] ?? Number.MAX_SAFE_INTEGER;
      return leftOrder - rightOrder;
    });
    return {
      ...group,
      jobs,
      nextMemberOffset,
      memberOrder,
    };
  });
}

export type CompanyGroupRemoval = {
  groups: CompanyJobGroup[];
  removedGroups: number;
  removedJobs: number;
  needsDirectoryRefresh: boolean;
};

export type CompanySiblingRemoval = {
  groups: CompanyJobGroup[];
  removedJobs: number;
};

/** Keep one active role and remove every other role represented by its company group. */
export function keepOnlyCompanyJob(
  groups: CompanyJobGroup[],
  companyId: string,
  keepJobId: string,
): CompanySiblingRemoval {
  let removedJobs = 0;
  const nextGroups = groups.map((group) => {
    if (group.companyId !== companyId) return group;
    const keptJob = group.jobs.find(
      (job) => job.id === keepJobId || job.backendId === keepJobId,
    );
    if (!keptJob) return group;

    removedJobs = Math.max(0, (group.matchingJobCount ?? group.jobs.length) - 1);
    return {
      ...group,
      jobs: [keptJob],
      matchingJobCount: 1,
      nextMemberOffset: null,
      memberOrder: { [keptJob.id]: 0 },
    };
  });

  return { groups: nextGroups, removedJobs };
}

export function removeCompanyJobs(
  groups: CompanyJobGroup[],
  shouldRemove: (job: Job) => boolean,
): CompanyGroupRemoval {
  let removedGroups = 0;
  let removedJobs = 0;
  let needsDirectoryRefresh = false;

  const nextGroups = groups.flatMap((group) => {
    const jobs = group.jobs.filter((job) => !shouldRemove(job));
    const removed = group.jobs.length - jobs.length;
    if (!removed) return [group];

    removedJobs += removed;
    const matchingJobCount = Math.max(0, (group.matchingJobCount ?? group.jobs.length) - removed);
    if (!jobs.length && matchingJobCount === 0) {
      removedGroups += 1;
      return [];
    }
    if (!jobs.length) needsDirectoryRefresh = true;

    return [{
      ...group,
      jobs,
      matchingJobCount,
      memberOrder: group.memberOrder
        ? Object.fromEntries(jobs.map((job) => [job.id, group.memberOrder?.[job.id] ?? 0]))
        : undefined,
      nextMemberOffset: group.nextMemberOffset == null
        ? null
        : Math.max(jobs.length, group.nextMemberOffset - removed),
    }];
  });

  return {
    groups: nextGroups,
    removedGroups,
    removedJobs,
    needsDirectoryRefresh,
  };
}
