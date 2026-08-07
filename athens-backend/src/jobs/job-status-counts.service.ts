import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { mapJobStatusCountsToTabs } from './mappers/job-status-counts.mapper';
import type { JobStatusTab } from './constants/job-list.constants';

@Injectable()
export class JobStatusCountsService {
  constructor(private readonly prisma: PrismaService) {}

  /** O(1) read of per-profile Job Search status badges. */
  async getTabCounts(
    profileId: string,
    catalogTotal = 0,
  ): Promise<Record<JobStatusTab, number>> {
    const id = String(profileId || '').trim();
    if (!id) {
      return mapJobStatusCountsToTabs(null, catalogTotal);
    }
    const row = await this.prisma.jobStatusCounts.findUnique({
      where: { profileId: id },
    });
    return mapJobStatusCountsToTabs(row, catalogTotal);
  }
}
