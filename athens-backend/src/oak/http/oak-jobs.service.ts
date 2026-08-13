import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { JobRecommendFieldsService } from '../../jobs/recommend/job-recommend-fields.service';
import { mapOakWorkerJob } from './mappers/oak-job.mapper';

const LIST_LIMIT_MAX = 200;

@Injectable()
export class OakJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly recommendFields: JobRecommendFieldsService,
  ) {}

  async list(applierName: string, limit = 100) {
    const account = await this.prisma.accountInfo.findUnique({
      where: { name: applierName },
      select: { id: true, name: true },
    });
    if (!account) {
      return { success: true as const, jobs: [], total: 0 };
    }

    const bounded = Math.min(Math.max(1, limit), LIST_LIMIT_MAX);
    const statuses = await this.prisma.jobStatus.findMany({
      where: { profileId: account.id, state: 'worker-pool' },
      orderBy: [{ workerPoolAt: 'desc' }, { postedAt: 'desc' }],
      take: bounded,
      select: { jobId: true, workerPoolAt: true },
    });

    const jobIds = statuses.map((row) => row.jobId);
    if (!jobIds.length) {
      return { success: true as const, jobs: [], total: 0 };
    }

    const jobs = await this.prisma.job.findMany({
      where: { id: { in: jobIds } },
      select: {
        id: true,
        title: true,
        companyName: true,
        applyLink: true,
        metadata: true,
      },
    });
    const jobById = new Map(jobs.map((job) => [job.id, job]));

    const recommendByJob = await this.recommendFields.loadForApplier(
      account.name,
      jobIds,
    );

    const mapped = [];
    for (const status of statuses) {
      const job = jobById.get(status.jobId);
      if (!job) continue;
      const recommend =
        recommendByJob.get(status.jobId) ||
        recommendByJob.get(status.jobId.toLowerCase());
      mapped.push(mapOakWorkerJob(job, status, recommend ?? null));
    }

    return {
      success: true as const,
      jobs: mapped,
      total: mapped.length,
    };
  }
}
