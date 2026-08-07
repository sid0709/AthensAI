import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CompanyCatalogTotalService } from './company-catalog-total.service';
import { CompanyMembershipService } from './company-membership.service';
import { JobCatalogTotalService } from './job-catalog-total.service';
import { normalizeJobIds } from './lib/normalize-job-ids';

export type HardDeleteResult = {
  success: true;
  deletedCount: number;
  deletedIds: string[];
  removedCount: number;
  removedIds: string[];
  alreadyAbsentCount: number;
};

/**
 * Permanent hard delete for catalog `jobs` and staging `temp_jobs`.
 * Also clears job_statuses and company membership for catalog rows.
 */
@Injectable()
export class JobHardDeleteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companies: CompanyMembershipService,
    private readonly jobTotals: JobCatalogTotalService,
    private readonly companyTotals: CompanyCatalogTotalService,
  ) {}

  async deleteCatalogJobs(rawIds: unknown): Promise<HardDeleteResult> {
    const ids = normalizeJobIds(rawIds);
    if (!ids.length) {
      return emptyResult();
    }

    const existing = await this.prisma.job.findMany({
      where: { id: { in: ids } },
      select: { id: true, companyId: true },
    });
    const deletedIds = existing.map((row) => row.id);
    if (!deletedIds.length) {
      return {
        success: true,
        deletedCount: 0,
        deletedIds: [],
        removedCount: ids.length,
        removedIds: ids,
        alreadyAbsentCount: ids.length,
      };
    }

    await this.prisma.jobStatus.deleteMany({
      where: { jobId: { in: deletedIds } },
    });
    await this.companies.detachJobs(existing);
    await this.prisma.job.deleteMany({ where: { id: { in: deletedIds } } });

    this.jobTotals.invalidate();
    this.companyTotals.invalidate();

    return {
      success: true,
      deletedCount: deletedIds.length,
      deletedIds,
      removedCount: ids.length,
      removedIds: ids,
      alreadyAbsentCount: ids.length - deletedIds.length,
    };
  }

  async deleteTempJobs(rawIds: unknown): Promise<HardDeleteResult> {
    const ids = normalizeJobIds(rawIds);
    if (!ids.length) {
      return emptyResult();
    }

    const existing = await this.prisma.tempJob.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    const deletedIds = existing.map((row) => row.id);
    if (!deletedIds.length) {
      return {
        success: true,
        deletedCount: 0,
        deletedIds: [],
        removedCount: ids.length,
        removedIds: ids,
        alreadyAbsentCount: ids.length,
      };
    }

    await this.prisma.tempJob.deleteMany({ where: { id: { in: deletedIds } } });

    return {
      success: true,
      deletedCount: deletedIds.length,
      deletedIds,
      removedCount: ids.length,
      removedIds: ids,
      alreadyAbsentCount: ids.length - deletedIds.length,
    };
  }

  async deleteOtherCompanyJobs(input: {
    companyId: string;
    keepJobId: string;
  }): Promise<HardDeleteResult> {
    const companyId = String(input.companyId || '').trim();
    const keepJobId = String(input.keepJobId || '').trim();
    if (!companyId || !keepJobId) {
      return emptyResult();
    }

    const siblings = await this.prisma.job.findMany({
      where: { companyId },
      select: { id: true },
    });
    const siblingIds = siblings.map((row) => row.id);
    if (!siblingIds.includes(keepJobId)) {
      const err = new Error(
        'The active job no longer belongs to this company group',
      ) as Error & { code?: string; status?: number };
      err.code = 'COMPANY_GROUP_CHANGED';
      err.status = 409;
      throw err;
    }

    const toDelete = siblingIds.filter((id) => id !== keepJobId);
    return this.deleteCatalogJobs(toDelete);
  }
}

function emptyResult(): HardDeleteResult {
  return {
    success: true,
    deletedCount: 0,
    deletedIds: [],
    removedCount: 0,
    removedIds: [],
    alreadyAbsentCount: 0,
  };
}
