import { Injectable } from '@nestjs/common';
import type { Job } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  deleteManyWithFallback,
  rawInsertOne,
  rawUpdateMany,
  withReplicaSetFallback,
} from '../prisma/mongo-standalone';
import type { JobStatusState } from '../jobs/constants/job-status-states.constants';
import { VendorTaskService } from './vendor-task.service';

const JOB_STATUSES_COLLECTION = 'job_statuses';

/**
 * JobStatus bid transitions with stable bidReadyAt + vendor_tasks stub.
 * Used by JobStatusMutateService and Lens bid lifecycle.
 */
@Injectable()
export class BidStatusQueueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vendorTasks: VendorTaskService,
  ) {}

  async setBidReady(input: {
    profileId: string;
    applierName: string;
    job: Job;
  }): Promise<{ bidReadyAt: Date; changed: boolean }> {
    const { profileId, job, applierName } = input;
    const existing = await this.prisma.jobStatus.findUnique({
      where: { profileId_jobId: { profileId, jobId: job.id } },
    });

    const now = new Date();
    const bidReadyAt = existing?.bidReadyAt ?? now;
    const previous = existing?.state ?? null;
    const changed = previous !== 'bid-ready';

    if (existing) {
      await withReplicaSetFallback(
        async () => {
          await this.prisma.jobStatus.update({
            where: { profileId_jobId: { profileId, jobId: job.id } },
            data: {
              state: 'bid-ready',
              bidReadyAt: existing.bidReadyAt ?? now,
              postedAt: existing.postedAt ?? job.postedAt,
              bidCompletedAt: null,
            },
          });
        },
        async () => {
          await rawUpdateMany(
            this.prisma,
            JOB_STATUSES_COLLECTION,
            {
              profileId: { $oid: profileId },
              jobId: { $oid: job.id },
            },
            {
              state: 'bid-ready',
              bidReadyAt: existing.bidReadyAt ?? now,
              postedAt: existing.postedAt ?? job.postedAt,
              bidCompletedAt: null,
              updatedAt: now,
            },
          );
        },
      );
    } else {
      await withReplicaSetFallback(
        async () => {
          await this.prisma.jobStatus.create({
            data: {
              profileId,
              jobId: job.id,
              state: 'bid-ready',
              bidReadyAt,
              postedAt: job.postedAt,
            },
          });
        },
        () =>
          rawInsertOne(this.prisma, JOB_STATUSES_COLLECTION, {
            profileId: { $oid: profileId },
            jobId: { $oid: job.id },
            state: 'bid-ready',
            bidReadyAt,
            postedAt: job.postedAt,
            createdAt: now,
            updatedAt: now,
          }),
      );
    }

    await this.vendorTasks.upsertBidReadyStub({
      applierName,
      job,
      bidReadyDate: bidReadyAt,
    });

    return { bidReadyAt, changed };
  }

  async setBidCompleted(input: {
    profileId: string;
    job: Job;
    existingBidReadyAt?: Date | null;
  }): Promise<void> {
    const { profileId, job } = input;
    const existing = await this.prisma.jobStatus.findUnique({
      where: { profileId_jobId: { profileId, jobId: job.id } },
    });
    const now = new Date();
    const bidReadyAt =
      existing?.bidReadyAt ?? input.existingBidReadyAt ?? now;

    if (existing) {
      await withReplicaSetFallback(
        async () => {
          await this.prisma.jobStatus.update({
            where: { profileId_jobId: { profileId, jobId: job.id } },
            data: {
              state: 'bid-completed',
              bidReadyAt,
              bidCompletedAt: existing.bidCompletedAt ?? now,
              postedAt: existing.postedAt ?? job.postedAt,
            },
          });
        },
        async () => {
          await rawUpdateMany(
            this.prisma,
            JOB_STATUSES_COLLECTION,
            {
              profileId: { $oid: profileId },
              jobId: { $oid: job.id },
            },
            {
              state: 'bid-completed',
              bidReadyAt,
              bidCompletedAt: existing.bidCompletedAt ?? now,
              postedAt: existing.postedAt ?? job.postedAt,
              updatedAt: now,
            },
          );
        },
      );
      return;
    }

    await withReplicaSetFallback(
      async () => {
        await this.prisma.jobStatus.create({
          data: {
            profileId,
            jobId: job.id,
            state: 'bid-completed',
            bidReadyAt,
            bidCompletedAt: now,
            postedAt: job.postedAt,
          },
        });
      },
      () =>
        rawInsertOne(this.prisma, JOB_STATUSES_COLLECTION, {
          profileId: { $oid: profileId },
          jobId: { $oid: job.id },
          state: 'bid-completed',
          bidReadyAt,
          bidCompletedAt: now,
          postedAt: job.postedAt,
          createdAt: now,
          updatedAt: now,
        }),
    );
  }

  async getBidReadyAt(
    profileId: string,
    jobId: string,
  ): Promise<Date | null> {
    const row = await this.prisma.jobStatus.findUnique({
      where: { profileId_jobId: { profileId, jobId } },
      select: { bidReadyAt: true },
    });
    return row?.bidReadyAt ?? null;
  }

  async listQueue(
    profileId: string,
    opts: { includeCompleted: boolean; limit: number },
  ) {
    const states: JobStatusState[] = opts.includeCompleted
      ? ['bid-ready', 'bid-completed']
      : ['bid-ready'];
    return this.prisma.jobStatus.findMany({
      where: { profileId, state: { in: states } },
      orderBy: [{ postedAt: 'desc' }, { updatedAt: 'desc' }],
      take: opts.limit,
    });
  }

  async clearStatus(profileId: string, jobId: string): Promise<number> {
    return deleteManyWithFallback(
      this.prisma,
      JOB_STATUSES_COLLECTION,
      {
        profileId: { $oid: profileId },
        jobId: { $oid: jobId },
      },
      () =>
        this.prisma.jobStatus.deleteMany({
          where: { profileId, jobId },
        }),
    );
  }
}
