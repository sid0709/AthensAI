import { Injectable } from '@nestjs/common';
import type { Job, Prisma, VendorTask } from '@prisma/client';
import { inferJobSource } from '../jobs/lib/infer-job-source';
import { normalizeJobMetadata } from '../jobs/mappers/job-metadata.mapper';
import {
  isReplicaSetRequired,
  rawInsertOne,
  rawUpdateMany,
  repairStringDateFields,
  withReplicaSetFallback,
} from '../prisma/mongo-standalone';
import { PrismaService } from '../prisma/prisma.service';
import { serializeVendorTask } from './mappers/vendor-task.mapper';

/** Must match `@@map("vendor_tasks")` on VendorTask in schema.prisma. */
const VENDOR_TASKS_COLLECTION = 'vendor_tasks';

const VENDOR_TASK_DATE_FIELDS = [
  'addedAt',
  'completedAt',
  'bidReadyDate',
  'bidderInProcessAt',
  'lastRejectedAt',
  'lastResubmittedAt',
  'recordingStartedAt',
  'recordingEndedAt',
  'recommendedAt',
  'analyzedAt',
  'flagAnalyzedAt',
  'createdAt',
  'updatedAt',
] as const;

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
    try {
      return await this.prisma.vendorTask.findUnique({
        where: {
          applierName_jobId: { applierName, jobId },
        },
      });
    } catch (error) {
      if (!isInconsistentDateTime(error)) throw error;
      await this.repairDates();
      return this.prisma.vendorTask.findUnique({
        where: {
          applierName_jobId: { applierName, jobId },
        },
      });
    }
  }

  async findById(id: string): Promise<VendorTask | null> {
    try {
      return await this.prisma.vendorTask.findUnique({ where: { id } });
    } catch (error) {
      if (!isInconsistentDateTime(error)) throw error;
      await this.repairDates();
      return this.prisma.vendorTask.findUnique({ where: { id } });
    }
  }

  async listForApplier(applierName: string, limit: number): Promise<VendorTask[]> {
    try {
      return await this.prisma.vendorTask.findMany({
        where: { applierName },
        orderBy: { addedAt: 'desc' },
        take: limit,
      });
    } catch (error) {
      if (!isInconsistentDateTime(error)) throw error;
      await this.repairDates();
      return this.prisma.vendorTask.findMany({
        where: { applierName },
        orderBy: { addedAt: 'desc' },
        take: limit,
      });
    }
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
      const data = {
        ...snapshot,
        ...(existing.bidReadyDate ? {} : { bidReadyDate }),
      };
      return this.updateById(existing.id, data);
    }

    return this.createTask({
      applierName,
      jobId: job.id,
      ...snapshot,
      status: 'pending',
      bidReadyDate,
      addedAt: bidReadyDate,
    });
  }

  async upsertFields(
    applierName: string,
    jobId: string,
    fields: VendorTaskUpsertFields,
    opts?: { incRejectCount?: boolean; incResubmitCount?: boolean },
  ): Promise<VendorTask> {
    const existing = await this.findByApplierJob(applierName, jobId);

    if (existing) {
      const updateData: Record<string, unknown> = { ...fields };
      if (existing.bidReadyDate && 'bidReadyDate' in updateData) {
        delete updateData.bidReadyDate;
      }
      if (opts?.incRejectCount) {
        updateData.rejectCount = (existing.rejectCount || 0) + 1;
      }
      if (opts?.incResubmitCount) {
        updateData.resubmitCount = (existing.resubmitCount || 0) + 1;
      }
      return this.updateById(existing.id, updateData);
    }

    return this.createTask({
      status: 'pending',
      ...fields,
      applierName,
      jobId,
      rejectCount: opts?.incRejectCount ? 1 : 0,
      resubmitCount: opts?.incResubmitCount ? 1 : 0,
    });
  }

  serialize(doc: VendorTask): Record<string, unknown> {
    return serializeVendorTask(doc);
  }

  private async createTask(
    data: Record<string, unknown>,
  ): Promise<VendorTask> {
    const now = new Date();
    const createData = {
      ...data,
      createdAt: (data.createdAt as Date) || now,
      updatedAt: now,
    } as Prisma.VendorTaskCreateInput;

    return withReplicaSetFallback(
      () => this.prisma.vendorTask.create({ data: createData }),
      async () => {
        const applierName = String(data.applierName || '');
        const jobId = String(data.jobId || '');
        await rawInsertOne(this.prisma, VENDOR_TASKS_COLLECTION, {
          ...stripUndefined(data),
          rejectCount: Number(data.rejectCount || 0),
          resubmitCount: Number(data.resubmitCount || 0),
          useCustomizedResume: Boolean(data.useCustomizedResume),
          resumeRenamed: Boolean(data.resumeRenamed),
          resumeMismatch: Boolean(data.resumeMismatch),
          bidderInProcess: Boolean(data.bidderInProcess),
          createdAt: now,
          updatedAt: now,
        });
        const created = await this.findByApplierJob(applierName, jobId);
        if (!created) {
          throw new Error('Failed to load vendor_tasks after raw insert');
        }
        return created;
      },
    );
  }

  private async updateById(
    id: string,
    data: Record<string, unknown>,
  ): Promise<VendorTask> {
    const now = new Date();
    try {
      return await this.prisma.vendorTask.update({
        where: { id },
        data: data as Prisma.VendorTaskUpdateInput,
      });
    } catch (error) {
      if (!isReplicaSetRequired(error)) throw error;
      await rawUpdateMany(
        this.prisma,
        VENDOR_TASKS_COLLECTION,
        { _id: { $oid: id } },
        { ...stripUndefined(data), updatedAt: now },
      );
      const updated = await this.findById(id);
      if (!updated) {
        throw new Error('Failed to load vendor_tasks after raw update');
      }
      return updated;
    }
  }

  private async repairDates(): Promise<void> {
    await repairStringDateFields(
      this.prisma,
      VENDOR_TASKS_COLLECTION,
      [...VENDOR_TASK_DATE_FIELDS],
    );
  }
}

function stripUndefined(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function isInconsistentDateTime(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Failed to convert .+ to 'DateTime'|Inconsistent column data/i.test(
    message,
  );
}
