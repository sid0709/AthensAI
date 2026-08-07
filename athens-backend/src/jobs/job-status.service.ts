import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  EMPTY_STATUS_COUNTS,
  type JobStatusTab,
} from './constants/job-list.constants';
import {
  JOB_STATUS_STATES,
  type JobStatusState,
} from './constants/job-status-states.constants';

const TRACKED_TABS = JOB_STATUS_STATES.filter(
  (state): state is Exclude<JobStatusState, 'posted'> => state !== 'posted',
);

@Injectable()
export class JobStatusService {
  constructor(private readonly prisma: PrismaService) {}

  /** States for one profile across a page of job ids. */
  async statesForJobs(
    profileId: string,
    jobIds: string[],
  ): Promise<Map<string, string>> {
    const id = String(profileId || '').trim();
    const ids = [
      ...new Set(jobIds.map((j) => String(j || '').trim()).filter(Boolean)),
    ];
    const out = new Map<string, string>();
    if (!id || !ids.length) return out;

    const rows = await this.prisma.jobStatus.findMany({
      where: { profileId: id, jobId: { in: ids } },
      select: { jobId: true, state: true },
    });
    for (const row of rows) out.set(row.jobId, row.state);
    return out;
  }

  /** Status-tab badges from `job_statuses` (no denormalized counter collection). */
  async tabCounts(
    profileId: string,
    catalogTotal = 0,
  ): Promise<Record<JobStatusTab, number>> {
    const counts: Record<JobStatusTab, number> = {
      ...EMPTY_STATUS_COUNTS,
      all: catalogTotal,
    };
    const id = String(profileId || '').trim();
    if (!id) return counts;

    const groups = await this.prisma.jobStatus.groupBy({
      by: ['state'],
      where: { profileId: id },
      _count: { _all: true },
    });

    let tracked = 0;
    for (const group of groups) {
      const state = group.state as JobStatusState;
      if (!(TRACKED_TABS as readonly string[]).includes(state)) continue;
      const n = group._count._all;
      counts[state] = n;
      tracked += n;
    }
    counts.posted = Math.max(0, catalogTotal - tracked);
    return counts;
  }

  /** Job ids currently in a non-posted pipeline state for this profile. */
  async jobIdsForState(profileId: string, state: string): Promise<string[]> {
    const id = String(profileId || '').trim();
    const status = String(state || '').trim();
    if (!id || !status || status === 'posted' || status === 'all') return [];

    const rows = await this.prisma.jobStatus.findMany({
      where: { profileId: id, state: status },
      select: { jobId: true },
    });
    return rows.map((row) => row.jobId);
  }

  /** Job ids that have any `job_statuses` row (i.e. not New/posted). */
  async jobIdsWithAnyStatus(profileId: string): Promise<string[]> {
    const id = String(profileId || '').trim();
    if (!id) return [];

    const rows = await this.prisma.jobStatus.findMany({
      where: {
        profileId: id,
        state: { in: [...TRACKED_TABS] },
      },
      select: { jobId: true },
    });
    return rows.map((row) => row.jobId);
  }
}
