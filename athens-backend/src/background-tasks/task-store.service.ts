import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  BACKGROUND_TASK_STATUSES,
  WORKER_LEASE_MS,
} from './constants/task-types';
import { publicTaskSnapshot } from './task-payload';

@Injectable()
export class TaskStoreService {
  constructor(private readonly prisma: PrismaService) {}

  toPublic(task: {
    id: string;
    requestId?: string | null;
    type: string;
    status: string;
    profileId?: string | null;
    applierName?: string | null;
    progress?: unknown;
    result?: unknown;
    error?: string | null;
    createdAt?: Date | null;
    startedAt?: Date | null;
    cancelRequestedAt?: Date | null;
    cancelAcknowledgedAt?: Date | null;
    finishedAt?: Date | null;
    updatedAt?: Date | null;
  }) {
    return publicTaskSnapshot(task);
  }

  async findById(id: string) {
    return this.prisma.backgroundTask.findUnique({ where: { id } });
  }

  async findByRequestId(requestId: string) {
    return this.prisma.backgroundTask.findFirst({
      where: { requestId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async list(opts: {
    profileId?: string;
    active?: boolean;
    limit?: number;
  }) {
    const limit = Math.min(100, Math.max(1, opts.limit || 50));
    const where: Prisma.BackgroundTaskWhereInput = {};
    if (opts.profileId) where.profileId = opts.profileId;
    if (opts.active) {
      where.status = {
        in: [
          BACKGROUND_TASK_STATUSES.QUEUED,
          BACKGROUND_TASK_STATUSES.RUNNING,
          BACKGROUND_TASK_STATUSES.CANCELLING,
        ],
      };
    }
    return this.prisma.backgroundTask.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: limit,
    });
  }

  async create(input: {
    requestId?: string;
    type: string;
    profileId?: string;
    applierName?: string;
    payload: Record<string, unknown>;
  }) {
    return this.prisma.backgroundTask.create({
      data: {
        requestId: input.requestId,
        type: input.type,
        status: BACKGROUND_TASK_STATUSES.QUEUED,
        profileId: input.profileId,
        applierName: input.applierName,
        payload: input.payload as Prisma.InputJsonValue,
        progress: {},
        eventSequence: 0,
      },
    });
  }

  async reserve(key: string, taskId: string, ttlMs = 24 * 60 * 60 * 1000) {
    try {
      await this.prisma.backgroundTaskReservation.create({
        data: {
          key,
          taskId,
          expiresAt: new Date(Date.now() + ttlMs),
        },
      });
      return true;
    } catch {
      return false;
    }
  }

  async findReservation(key: string) {
    return this.prisma.backgroundTaskReservation.findUnique({ where: { key } });
  }

  async updateProgress(
    id: string,
    progress: Record<string, unknown>,
    patch: { status?: string; eventSequence?: number } = {},
  ) {
    return this.prisma.backgroundTask.update({
      where: { id },
      data: {
        progress: progress as Prisma.InputJsonValue,
        ...(patch.status ? { status: patch.status } : {}),
        eventSequence: { increment: 1 },
      },
    });
  }

  async complete(
    id: string,
    result: Record<string, unknown>,
    status:
      | typeof BACKGROUND_TASK_STATUSES.COMPLETED
      | typeof BACKGROUND_TASK_STATUSES.COMPLETED_WITH_ERRORS
      | typeof BACKGROUND_TASK_STATUSES.FAILED
      | typeof BACKGROUND_TASK_STATUSES.CANCELLED,
    error?: string,
  ) {
    return this.prisma.backgroundTask.update({
      where: { id },
      data: {
        status,
        result: result as Prisma.InputJsonValue,
        error: error || null,
        finishedAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
        eventSequence: { increment: 1 },
      },
    });
  }

  async requestCancel(id: string) {
    const task = await this.findById(id);
    if (!task) return null;
    if (task.status === BACKGROUND_TASK_STATUSES.QUEUED) {
      return this.prisma.backgroundTask.update({
        where: { id },
        data: {
          status: BACKGROUND_TASK_STATUSES.CANCELLED,
          cancelRequestedAt: new Date(),
          finishedAt: new Date(),
          eventSequence: { increment: 1 },
        },
      });
    }
    if (
      task.status === BACKGROUND_TASK_STATUSES.RUNNING ||
      task.status === BACKGROUND_TASK_STATUSES.CANCELLING
    ) {
      return this.prisma.backgroundTask.update({
        where: { id },
        data: {
          status: BACKGROUND_TASK_STATUSES.CANCELLING,
          cancelRequestedAt: new Date(),
          eventSequence: { increment: 1 },
        },
      });
    }
    return task;
  }

  async claimNext(workerId: string, type?: string) {
    const now = new Date();
    const candidates = await this.prisma.backgroundTask.findMany({
      where: {
        status: BACKGROUND_TASK_STATUSES.QUEUED,
        ...(type ? { type } : {}),
      },
      orderBy: { createdAt: 'asc' },
      take: 5,
    });
    for (const task of candidates) {
      try {
        const updated = await this.prisma.backgroundTask.updateMany({
          where: {
            id: task.id,
            status: BACKGROUND_TASK_STATUSES.QUEUED,
          },
          data: {
            status: BACKGROUND_TASK_STATUSES.RUNNING,
            startedAt: now,
            leaseOwner: workerId,
            leaseExpiresAt: new Date(Date.now() + WORKER_LEASE_MS),
            eventSequence: { increment: 1 },
          },
        });
        if (updated.count === 1) {
          return this.findById(task.id);
        }
      } catch {
        /* race */
      }
    }
    return null;
  }

  async heartbeat(id: string, workerId: string) {
    await this.prisma.backgroundTask.updateMany({
      where: { id, leaseOwner: workerId },
      data: {
        leaseExpiresAt: new Date(Date.now() + WORKER_LEASE_MS),
      },
    });
  }

  async listSince(profileId: string, since: Date) {
    return this.prisma.backgroundTask.findMany({
      where: {
        profileId,
        updatedAt: { gt: since },
      },
      orderBy: { updatedAt: 'asc' },
      take: 100,
    });
  }
}
