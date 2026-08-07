import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { isoOrNull } from './lib/iso';

@Injectable()
export class BidReviewEventsService {
  constructor(private readonly prisma: PrismaService) {}

  async append(input: {
    applierName: string;
    jobId: string;
    vendorTaskId?: string | null;
    eventType: string;
    eventKey?: string | null;
    meta?: Record<string, unknown> | null;
    feature?: string | null;
  }) {
    const eventKey =
      String(input.eventKey || '').trim() || `evt:${randomUUID()}`;
    try {
      return await this.prisma.bidReviewEvent.create({
        data: {
          applierName: input.applierName,
          jobId: input.jobId,
          vendorTaskId: input.vendorTaskId ?? null,
          eventType: input.eventType,
          eventKey,
          meta: (input.meta ?? undefined) as Prisma.InputJsonValue | undefined,
          feature: input.feature ?? null,
        },
      });
    } catch {
      // Unique eventKey — treat as idempotent no-op
      return this.prisma.bidReviewEvent.findFirst({
        where: {
          applierName: input.applierName,
          jobId: input.jobId,
          eventKey,
        },
      });
    }
  }

  async listForJob(applierName: string, jobId: string, limit = 100) {
    const rows = await this.prisma.bidReviewEvent.findMany({
      where: { applierName, jobId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map((row) => ({
      id: row.id,
      applierName: row.applierName,
      jobId: row.jobId,
      vendorTaskId: row.vendorTaskId,
      eventType: row.eventType,
      eventKey: row.eventKey,
      meta: row.meta,
      feature: row.feature,
      createdAt: isoOrNull(row.createdAt),
    }));
  }
}
