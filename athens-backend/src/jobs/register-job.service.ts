import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma, TempJob } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CompanyCatalogTotalService } from './company-catalog-total.service';
import { CompanyMembershipService } from './company-membership.service';
import { isJobCatalogReady } from './constants/job-catalog-readiness.constants';
import {
  toCatalogJobMetadata,
  normalizeJobMetadata,
} from './mappers/job-metadata.mapper';

function requireNonEmpty(value: string | null | undefined, field: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new BadRequestException(`registerJob rejected: ${field} is required`);
  }
  return value.trim();
}

function toJobCreateData(
  row: TempJob,
  companyId: string,
): Prisma.JobUncheckedCreateInput {
  requireNonEmpty(row.title, 'title');
  requireNonEmpty(row.companyName, 'companyName');
  requireNonEmpty(row.source, 'source');
  requireNonEmpty(row.titleReviewLabel, 'titleReviewLabel');
  requireNonEmpty(row.modelSchemaCode, 'modelSchemaCode');
  requireNonEmpty(row.createdBy, 'createdBy');
  if (!(row.postedAt instanceof Date) || Number.isNaN(row.postedAt.getTime())) {
    throw new BadRequestException('registerJob rejected: postedAt is invalid');
  }
  if (!isJobCatalogReady(row)) {
    throw new BadRequestException(
      'registerJob rejected: title review / skill extract not complete',
    );
  }

  const metadata = toCatalogJobMetadata(row.metadata);

  return {
    id: row.id,
    title: row.title.trim(),
    companyName: row.companyName.trim(),
    companyId,
    source: row.source.trim(),
    postedAt: row.postedAt,
    titleReviewLabel: row.titleReviewLabel.trim(),
    sourceCatalog: row.sourceCatalog || 'market',
    companyLink: row.companyLink,
    applyLink: row.applyLink,
    description: row.description,
    aiSkills: row.aiSkills ?? undefined,
    aiSkillStatus: row.aiSkillStatus,
    modelSchemaCode: row.modelSchemaCode.trim(),
    createdBy: row.createdBy.trim(),
    createdAt: row.createdAt,
    ...(metadata ? { metadata: metadata as Prisma.InputJsonValue } : {}),
  };
}

/**
 * Single write path into searchable `jobs`. Moves (does not copy) a ready TempJob.
 * Upserts `companies` (fill-null URL/logo), then attaches the job id after Job create.
 */
@Injectable()
export class RegisterJobService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companies: CompanyMembershipService,
    private readonly companyTotals: CompanyCatalogTotalService,
  ) {}

  /**
   * Move one temp row into jobs when ready and schema-complete.
   * Returns false if missing or not catalog-ready (no throw).
   * Throws BadRequestException when ready but Job contract validation fails.
   */
  async registerJob(tempJobId: string): Promise<boolean> {
    const row = await this.prisma.tempJob.findUnique({
      where: { id: tempJobId },
    });
    if (!row || !isJobCatalogReady(row)) return false;

    const meta = normalizeJobMetadata(row.metadata);
    const companyId = await this.companies.upsertProfile({
      companyName: row.companyName,
      companyUrl: row.companyLink,
      companyLogo: meta?.companyLogo ?? null,
    });

    const data = toJobCreateData(row, companyId);

    // Avoid $transaction — standalone Mongo has no replica-set transactions.
    await this.prisma.job.create({ data });
    await this.prisma.tempJob.delete({ where: { id: row.id } });

    await this.companies.attachJob({
      companyId,
      jobId: row.id,
      postedAt: row.postedAt,
    });
    this.companyTotals.invalidate();
    return true;
  }
}
