import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { PrenormTempJobInput } from './mappers/prenorm-scrape.mapper';

export type SaveJobResult =
  | {
      success: true;
      created: true;
      duplicate: false;
      id: string;
      jobID?: string;
      jobLink?: string;
      source?: string;
    }
  | {
      success: true;
      created: false;
      duplicate: true;
      id?: string;
      jobID?: string;
      jobLink?: string;
      reason: string;
    };

function legacyIdFrom(data: PrenormTempJobInput): string | undefined {
  const meta = data.metadata;
  if (!meta || typeof meta !== 'object' || Array.isArray(meta))
    return undefined;
  const legacyId = (meta as { legacyId?: unknown }).legacyId;
  return typeof legacyId === 'string' && legacyId.trim()
    ? legacyId.trim()
    : undefined;
}

@Injectable()
export class SaveJobService {
  constructor(private readonly prisma: PrismaService) {}

  async save(data: PrenormTempJobInput): Promise<SaveJobResult> {
    const legacyId = legacyIdFrom(data);
    const applyLink =
      typeof data.applyLink === 'string' && data.applyLink.trim()
        ? data.applyLink.trim()
        : undefined;

    const duplicate = await this.findDuplicate(legacyId, applyLink);
    if (duplicate) {
      return {
        success: true,
        created: false,
        duplicate: true,
        id: duplicate.id,
        ...(legacyId ? { jobID: legacyId } : {}),
        ...(applyLink ? { jobLink: applyLink } : {}),
        reason: duplicate.reason,
      };
    }

    const created = await this.prisma.tempJob.create({ data });
    return {
      success: true,
      created: true,
      duplicate: false,
      id: created.id,
      ...(legacyId ? { jobID: legacyId } : {}),
      ...(created.applyLink ? { jobLink: created.applyLink } : {}),
      source: created.source,
    };
  }

  async existsByLegacyId(jobID: string): Promise<boolean> {
    const id = String(jobID || '').trim();
    if (!id) return false;
    const found = await this.findByLegacyId(id);
    return Boolean(found);
  }

  private async findDuplicate(
    legacyId: string | undefined,
    applyLink: string | undefined,
  ): Promise<{ id: string; reason: string } | null> {
    if (legacyId) {
      const byLegacy = await this.findByLegacyId(legacyId);
      if (byLegacy) {
        return {
          id: byLegacy.id,
          reason: 'Duplicate jobID already exists',
        };
      }
    }
    if (applyLink) {
      const [temp, job] = await Promise.all([
        this.prisma.tempJob.findFirst({
          where: { applyLink },
          select: { id: true },
        }),
        this.prisma.job.findFirst({
          where: { applyLink },
          select: { id: true },
        }),
      ]);
      const hit = temp ?? job;
      if (hit) {
        return {
          id: hit.id,
          reason: 'Duplicate job URL already exists',
        };
      }
    }
    return null;
  }

  private async findByLegacyId(
    legacyId: string,
  ): Promise<{ id: string } | null> {
    const where = {
      metadata: { path: ['legacyId'], equals: legacyId },
    } as Prisma.TempJobWhereInput;
    const [temp, job] = await Promise.all([
      this.prisma.tempJob.findFirst({ where, select: { id: true } }),
      this.prisma.job.findFirst({
        where: {
          metadata: { path: ['legacyId'], equals: legacyId },
        } as Prisma.JobWhereInput,
        select: { id: true },
      }),
    ]);
    return temp ?? job;
  }
}
