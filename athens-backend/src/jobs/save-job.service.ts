import { Injectable } from '@nestjs/common';
import type { PrenormTempJobInput } from './mappers/prenorm-scrape.mapper';
import { JobDedupeService } from './job-dedupe.service';
import { PrismaService } from '../prisma/prisma.service';

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
      code?: string;
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly dedupe: JobDedupeService,
  ) {}

  /**
   * Prenorm → dedupe (temp_jobs + jobs) → create TempJob.
   * Duplicates return success with `duplicate: true` (Extension / LI-scrapper contract).
   */
  async save(data: PrenormTempJobInput): Promise<SaveJobResult> {
    const legacyId = legacyIdFrom(data);
    const applyLink =
      typeof data.applyLink === 'string' && data.applyLink.trim()
        ? data.applyLink.trim()
        : undefined;

    const duplicate = await this.dedupe.findDuplicate({
      legacyId,
      applyLink,
      companyName: data.companyName,
      title: data.title,
    });
    if (duplicate) {
      return {
        success: true,
        created: false,
        duplicate: true,
        id: duplicate.id,
        ...(legacyId ? { jobID: legacyId } : {}),
        ...(applyLink ? { jobLink: applyLink } : {}),
        reason: duplicate.reason,
        code: duplicate.code,
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
    return this.dedupe.existsByLegacyId(jobID);
  }
}
