import { Injectable } from '@nestjs/common';
import { BidStatusQueueService } from '../bids/bid-status-queue.service';
import { isoOrNull } from '../bids/lib/iso';
import { normalizeJobMetadata } from '../jobs/mappers/job-metadata.mapper';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class LensJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bidQueue: BidStatusQueueService,
  ) {}

  async list(applierName: string, limit = 100) {
    const account = await this.prisma.accountInfo.findUnique({
      where: { name: applierName },
      select: { id: true, name: true },
    });
    if (!account) {
      return { success: true as const, jobs: [], total: 0 };
    }

    const bounded = Math.min(Math.max(1, limit), 200);
    const statuses = await this.bidQueue.listQueue(account.id, {
      includeCompleted: false,
      limit: bounded,
    });

    const jobIds = statuses.map((s) => s.jobId);
    const jobs = await this.prisma.job.findMany({
      where: { id: { in: jobIds } },
    });
    const jobById = new Map(jobs.map((j) => [j.id, j]));

    const tasks = await this.prisma.vendorTask.findMany({
      where: { applierName: account.name, jobId: { in: jobIds } },
      select: {
        jobId: true,
        recommendedResumeStack: true,
        recommendedResumeReason: true,
        useCustomizedResume: true,
        recommendWarning: true,
        recommendedAt: true,
      },
    });
    const recommendByJob = new Map(tasks.map((t) => [t.jobId, t]));

    const mapped = [];
    for (const status of statuses) {
      const job = jobById.get(status.jobId);
      if (!job) continue;
      const recommend = recommendByJob.get(status.jobId);
      mapped.push(mapAthensLensJob(job, status, recommend));
    }

    return {
      success: true as const,
      jobs: mapped,
      total: mapped.length,
    };
  }
}

function mapAthensLensJob(
  job: {
    id: string;
    title: string;
    companyName: string;
    postedAt: Date;
    applyLink: string | null;
    description: string | null;
    source: string;
    metadata: unknown;
    aiSkills: unknown;
  },
  status: { bidReadyAt: Date | null; postedAt: Date | null },
  recommend?: {
    recommendedResumeStack: string | null;
    recommendedResumeReason: string | null;
    useCustomizedResume: boolean;
    recommendWarning: string | null;
    recommendedAt: Date | null;
  } | null,
) {
  const meta = normalizeJobMetadata(job.metadata) ?? {};
  const details = meta.details ?? {};
  const scrape = meta.scrape ?? {};
  const skills = Array.isArray(job.aiSkills)
    ? (job.aiSkills as Array<{ name?: string }>)
        .map((s) => String(s?.name || '').trim())
        .filter(Boolean)
    : Array.isArray(scrape.skills)
      ? scrape.skills
      : [];

  const posted = status.postedAt ?? job.postedAt;
  const bidReady = status.bidReadyAt;

  return {
    id: job.id,
    title: job.title,
    company: job.companyName,
    companyLogoUrl: meta.companyLogo || null,
    location: details.location || '',
    workMode: details.remote || '',
    employmentType: details.time || '',
    seniority: details.seniority || '',
    salary: details.salary || '',
    experience: '',
    postedAt: posted ? posted.toISOString().slice(0, 10) : null,
    skills,
    tags: Array.isArray(scrape.tags) ? scrape.tags : [],
    applicantsText: scrape.applicants?.text || null,
    description: job.description || '',
    responsibilities: [] as string[],
    qualifications: [] as string[],
    applyUrl: job.applyLink || null,
    bidReadyAt: bidReady ? bidReady.toISOString().slice(0, 10) : null,
    recommendedResumeStack: recommend?.recommendedResumeStack ?? null,
    recommendedResumeReason: recommend?.recommendedResumeReason ?? null,
    useCustomizedResume: Boolean(recommend?.useCustomizedResume),
    recommendWarning: recommend?.recommendWarning ?? null,
    recommendedAt: isoOrNull(recommend?.recommendedAt ?? null),
  };
}
