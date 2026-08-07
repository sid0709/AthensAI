import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  JOB_DEDUP_WINDOW_DAYS,
  jobDedupCutoff,
} from './constants/job-ingest.config';
import {
  buildJobIdentityKeys,
  escapeRegex,
  normalizeJobIdentityText,
} from './lib/job-identity';

export type DuplicateHit = {
  id: string;
  reason: string;
  code:
    | 'DUPLICATE_JOB_ID'
    | 'DUPLICATE_APPLY_LINK'
    | 'DUPLICATE_COMPANY_TITLE';
};

type DedupeInput = {
  legacyId?: string;
  applyLink?: string;
  companyName?: string;
  title?: string;
};

/**
 * Cross-collection dedupe for Extension / LI-scrapper ingest.
 * Looks in both `temp_jobs` and `jobs` within JOB_DEDUP_WINDOW_DAYS
 * (legacyId is always treated as a hard duplicate).
 */
@Injectable()
export class JobDedupeService {
  constructor(private readonly prisma: PrismaService) {}

  async findDuplicate(input: DedupeInput): Promise<DuplicateHit | null> {
    const legacyId = String(input.legacyId || '').trim();
    if (legacyId) {
      const byLegacy = await this.findByLegacyId(legacyId);
      if (byLegacy) {
        return {
          id: byLegacy.id,
          code: 'DUPLICATE_JOB_ID',
          reason: 'Duplicate jobID already exists',
        };
      }
    }

    const cutoff = jobDedupCutoff();
    const applyLink = String(input.applyLink || '').trim();
    if (applyLink) {
      const byUrl = await this.findByApplyLink(applyLink, cutoff);
      if (byUrl) {
        return {
          id: byUrl.id,
          code: 'DUPLICATE_APPLY_LINK',
          reason: `Job with this URL has been posted within the last ${JOB_DEDUP_WINDOW_DAYS} days`,
        };
      }
    }

    const identity = buildJobIdentityKeys(input.companyName, input.title);
    if (identity) {
      const byIdentity = await this.findByCompanyTitle(
        identity.companyKey,
        identity.titleKey,
        cutoff,
      );
      if (byIdentity) {
        return {
          id: byIdentity.id,
          code: 'DUPLICATE_COMPANY_TITLE',
          reason: `Duplicate job with this company and title was added within the last ${JOB_DEDUP_WINDOW_DAYS} days`,
        };
      }
    }

    return null;
  }

  async existsByLegacyId(jobID: string): Promise<boolean> {
    const id = String(jobID || '').trim();
    if (!id) return false;
    return Boolean(await this.findByLegacyId(id));
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

  private async findByApplyLink(
    applyLink: string,
    cutoff: Date,
  ): Promise<{ id: string } | null> {
    const where = {
      applyLink,
      createdAt: { gte: cutoff },
    };
    const [temp, job] = await Promise.all([
      this.prisma.tempJob.findFirst({
        where,
        select: { id: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.job.findFirst({
        where,
        select: { id: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return temp ?? job;
  }

  private async findByCompanyTitle(
    companyKey: string,
    titleKey: string,
    cutoff: Date,
  ): Promise<{ id: string } | null> {
    const companyPattern = `^${escapeRegex(companyKey)}$`;
    const titlePattern = `^${escapeRegex(titleKey)}$`;
    const match = {
      createdAt: { $gte: { $date: cutoff.toISOString() } },
      companyName: { $regex: companyPattern, $options: 'i' },
      title: { $regex: titlePattern, $options: 'i' },
    };

    const [tempRaw, jobRaw] = await Promise.all([
      this.prisma.tempJob.findRaw({
        filter: match as Prisma.InputJsonValue,
        options: {
          projection: { _id: 1, companyName: 1, title: 1 },
          sort: { createdAt: -1 },
          limit: 8,
        } as Prisma.InputJsonValue,
      }),
      this.prisma.job.findRaw({
        filter: match as Prisma.InputJsonValue,
        options: {
          projection: { _id: 1, companyName: 1, title: 1 },
          sort: { createdAt: -1 },
          limit: 8,
        } as Prisma.InputJsonValue,
      }),
    ]);

    const hit =
      pickIdentityHit(tempRaw, companyKey, titleKey) ??
      pickIdentityHit(jobRaw, companyKey, titleKey);
    return hit;
  }
}

function asObjectIdHex(value: unknown): string | null {
  if (typeof value === 'string' && /^[a-fA-F0-9]{24}$/.test(value)) return value;
  if (value && typeof value === 'object' && '$oid' in value) {
    const oid = (value as { $oid?: unknown }).$oid;
    return typeof oid === 'string' && /^[a-fA-F0-9]{24}$/.test(oid)
      ? oid
      : null;
  }
  return null;
}

/**
 * Regex with `i` can over-match Unicode edge cases; confirm with NFKC keys.
 */
function pickIdentityHit(
  raw: unknown,
  companyKey: string,
  titleKey: string,
): { id: string } | null {
  const rows = Array.isArray(raw) ? raw : [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const doc = row as {
      _id?: unknown;
      companyName?: unknown;
      title?: unknown;
    };
    if (
      normalizeJobIdentityText(doc.companyName) !== companyKey ||
      normalizeJobIdentityText(doc.title) !== titleKey
    ) {
      continue;
    }
    const id = asObjectIdHex(doc._id);
    if (id) return { id };
  }
  return null;
}
