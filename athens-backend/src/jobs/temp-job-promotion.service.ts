import { Injectable } from '@nestjs/common';
import type { Prisma, TempJob } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { isJobCatalogReady } from './constants/job-catalog-readiness.constants';

function toJobCreateData(row: TempJob): Prisma.JobUncheckedCreateInput {
  return {
    id: row.id,
    title: row.title,
    companyName: row.companyName,
    source: row.source,
    postedAt: row.postedAt,
    titleReviewLabel: row.titleReviewLabel,
    sourceCatalog: row.sourceCatalog,
    companyLink: row.companyLink,
    applyLink: row.applyLink,
    description: row.description,
    aiSkills: row.aiSkills ?? undefined,
    aiSkillStatus: row.aiSkillStatus,
    modelSchemaCode: row.modelSchemaCode,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    metadata: row.metadata ?? undefined,
  };
}

/**
 * Moves a ready TempJob into `jobs` (delete from temp). AI pipelines call this
 * after both title review and skill extract complete — not wired to AI yet.
 */
@Injectable()
export class TempJobPromotionService {
  constructor(private readonly prisma: PrismaService) {}

  isReady(job: {
    titleReviewLabel: string;
    aiSkillStatus: string | null | undefined;
  }) {
    return isJobCatalogReady(job);
  }

  /** Move one temp row into jobs when ready. Returns false if missing or not ready. */
  async promoteIfReady(tempJobId: string): Promise<boolean> {
    const row = await this.prisma.tempJob.findUnique({
      where: { id: tempJobId },
    });
    if (!row || !isJobCatalogReady(row)) return false;

    await this.prisma.job.create({ data: toJobCreateData(row) });
    await this.prisma.tempJob.delete({ where: { id: row.id } });
    await this.prisma.athensMetadata.deleteMany({ where: { jobId: row.id } });
    return true;
  }
}
