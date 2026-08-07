import { Injectable } from '@nestjs/common';
import type { Job, Prisma, VendorTask } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { inferJobSource } from '../jobs/lib/infer-job-source';
import { normalizeJobMetadata } from '../jobs/mappers/job-metadata.mapper';
import { serializeVendorTask } from './mappers/vendor-task.mapper';

export type VendorTaskUpsertFields = Partial<{
  title: string;
  company: string;
  applyUrl: string | null;
  source: string;
  location: string;
  workMode: string;
  matchScore: number | null;
  status: string;
  reviewStatus: string | null;
  bidderInProcess: boolean;
  bidderInProcessAt: Date | null;
  bidderName: string | null;
  bidSessionId: string | null;
  completedAt: Date | null;
  bidReadyDate: Date | null;
  biddingDurationSec: number | null;
  rejectReason: string | null;
  rejectSource: string | null;
  lastRejectedAt: Date | null;
  lastResubmittedAt: Date | null;
  recordingPath: string | null;
  recordingContentType: string | null;
  recordingSize: number | null;
  recordingSha256: string | null;
  recordingGeneration: string | null;
  recordingDurationSec: number | null;
  recordingStartedAt: Date | null;
  recordingEndedAt: Date | null;
  recordings: Prisma.InputJsonValue;
  recommendedResumeStack: string | null;
  recommendedResumeReason: string | null;
  useCustomizedResume: boolean;
  recommendWarning: string | null;
  recommendedAt: Date | null;
  recommendMode: string | null;
  recommendUsage: Prisma.InputJsonValue;
  recommendRequestId: string | null;
  resumeStackMatch: string | null;
  resumeOriginalName: string | null;
  resumeExpectedName: string | null;
  resumeCleanedName: string | null;
  resumeRenamed: boolean;
  resumeMismatch: boolean;
  resumeAudits: Prisma.InputJsonValue;
  analysisSummary: string | null;
  analysisFormAnswers: Prisma.InputJsonValue;
  analysisMode: string | null;
  analysisPageUrl: string | null;
  analysisPageTitle: string | null;
  analysisUsage: Prisma.InputJsonValue;
  analysisRequestId: string | null;
  analyzedAt: Date | null;
  flags: Prisma.InputJsonValue;
}>;

@Injectable()
export class VendorTaskService {
  constructor(private readonly prisma: PrismaService) {}

  async findByApplierJob(
    applierName: string,
    jobId: string,
  ): Promise<VendorTask | null> {
    return this.prisma.vendorTask.findUnique({
      where: {
        applierName_jobId: { applierName, jobId },
      },
    });
  }

  async findById(id: string): Promise<VendorTask | null> {
    return this.prisma.vendorTask.findUnique({ where: { id } });
  }

  async listForApplier(applierName: string, limit: number): Promise<VendorTask[]> {
    return this.prisma.vendorTask.findMany({
      where: { applierName },
      orderBy: { addedAt: 'desc' },
      take: limit,
    });
  }

  async listRejected(applierName: string, limit: number): Promise<VendorTask[]> {
    return this.prisma.vendorTask.findMany({
      where: { applierName, reviewStatus: 'rejected' },
      orderBy: [{ lastRejectedAt: 'desc' }, { updatedAt: 'desc' }],
      take: limit,
    });
  }

  /** Upsert stub when Job Search marks Bid Ready. Does not restamp bidReadyDate. */
  async upsertBidReadyStub(input: {
    applierName: string;
    job: Job;
    bidReadyDate: Date;
  }): Promise<VendorTask> {
    const { applierName, job, bidReadyDate } = input;
    const meta = normalizeJobMetadata(job.metadata) ?? {};
    const location = meta.details?.location ?? '';
    const workMode = meta.details?.remote ?? '';
    const applyUrl = job.applyLink ?? null;
    const snapshot = {
      title: job.title || 'Untitled role',
      company: job.companyName || '',
      applyUrl,
      source: job.source || inferJobSource(applyUrl),
      location,
      workMode,
    };

    const existing = await this.findByApplierJob(applierName, job.id);
    if (existing) {
      return this.prisma.vendorTask.update({
        where: { id: existing.id },
        data: {
          ...snapshot,
          ...(existing.bidReadyDate ? {} : { bidReadyDate }),
        },
      });
    }

    return this.prisma.vendorTask.create({
      data: {
        applierName,
        jobId: job.id,
        ...snapshot,
        status: 'pending',
        bidReadyDate,
        addedAt: bidReadyDate,
      },
    });
  }

  async upsertFields(
    applierName: string,
    jobId: string,
    fields: VendorTaskUpsertFields,
    opts?: { incRejectCount?: boolean; incResubmitCount?: boolean },
  ): Promise<VendorTask> {
    const existing = await this.findByApplierJob(applierName, jobId);
    const data: Prisma.VendorTaskUpdateInput = { ...fields };

    if (existing) {
      const updateData: Prisma.VendorTaskUpdateInput = { ...data };
      if (opts?.incRejectCount) {
        updateData.rejectCount = { increment: 1 };
      }
      if (opts?.incResubmitCount) {
        updateData.resubmitCount = { increment: 1 };
      }
      // Never restamp bidReadyDate if already set
      if (existing.bidReadyDate && 'bidReadyDate' in updateData) {
        delete updateData.bidReadyDate;
      }
      return this.prisma.vendorTask.update({
        where: { id: existing.id },
        data: updateData,
      });
    }

    return this.prisma.vendorTask.create({
      data: {
        status: 'pending',
        ...(fields as Prisma.VendorTaskCreateInput),
        applierName,
        jobId,
        rejectCount: opts?.incRejectCount ? 1 : 0,
        resubmitCount: opts?.incResubmitCount ? 1 : 0,
      },
    });
  }

  serialize(doc: VendorTask): Record<string, unknown> {
    return serializeVendorTask(doc);
  }
}
