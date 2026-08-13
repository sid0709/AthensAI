import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { mapOakWorkerJob } from './mappers/oak-job.mapper';

const LIST_LIMIT_MAX = 200;

@Injectable()
export class OakJobsService {
  constructor(private readonly prisma: PrismaService) {}

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

    const tasks = await this.prisma.vendorTask.findMany({
      where: { applierName: account.name, jobId: { in: jobIds } },
      select: {
        jobId: true,
        recommendedResumeStack: true,
        recommendedResumeId: true,
        recommendedResumeReason: true,
        recommendWarning: true,
        recommendedAt: true,
      },
    });
    const recommendByJob = new Map(tasks.map((task) => [task.jobId, task]));

    const mapped = [];
    for (const status of statuses) {
      const job = jobById.get(status.jobId);
      if (!job) continue;
      mapped.push(
        mapOakWorkerJob(job, status, recommendByJob.get(status.jobId) ?? null),
      );
    }

    return {
      success: true as const,
      jobs: mapped,
      total: mapped.length,
    };
  }
}
