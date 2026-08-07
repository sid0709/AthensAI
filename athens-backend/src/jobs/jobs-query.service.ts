import { Injectable } from '@nestjs/common';
import type { ListJobsQueryDto } from './dto/list-jobs.query.dto';
import {
  EMPTY_STATUS_COUNTS,
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_MAX,
  type JobStatusTab,
} from './constants/job-list.constants';
import { CompanyCatalogTotalService } from './company-catalog-total.service';
import { JobCatalogTotalService } from './job-catalog-total.service';
import { JobStatusService } from './job-status.service';
import { JobsCompanyListService } from './jobs-company-list.service';
import type { JobsIdConstraint } from './lib/jobs-mongo-match';
import { buildJobsPrismaWhere, isEmptyWhere } from './lib/jobs-where';

@Injectable()
export class JobsQueryService {
  constructor(
    private readonly catalogTotal: JobCatalogTotalService,
    private readonly companyCatalogTotal: CompanyCatalogTotalService,
    private readonly jobStatuses: JobStatusService,
    private readonly companyList: JobsCompanyListService,
  ) {}

  async list(query: ListJobsQueryDto) {
    const status = (query.status || 'all') as JobStatusTab;
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(
      PAGE_SIZE_MAX,
      Math.max(1, query.pageSize ?? PAGE_SIZE_DEFAULT),
    );
    const profileId = String(query.profileId ?? '').trim();

    const where = buildJobsPrismaWhere(query);
    const unfiltered = isEmptyWhere(where);
    const peekJobs = unfiltered ? (this.catalogTotal.peek() ?? 0) : 0;

    const idConstraint = await this.statusIdConstraint(status, profileId);
    if (idConstraint && 'includeIds' in idConstraint && !idConstraint.includeIds.length) {
      const tabCounts = await this.jobStatuses.tabCounts(profileId, peekJobs);
      return this.emptyPage(page, pageSize, tabCounts);
    }

    const needsStatusFilter = status !== 'all';

    if (unfiltered && !needsStatusFilter) {
      const [companyTotal, jobTotal, data, tabCounts] = await Promise.all([
        this.companyCatalogTotal.getUnfiltered(),
        this.catalogTotal.getUnfiltered(),
        this.companyList.listUnfiltered(page, pageSize, profileId),
        this.jobStatuses.tabCounts(profileId, peekJobs),
      ]);

      if (tabCounts.all !== jobTotal) {
        tabCounts.all = jobTotal;
      }

      const totalPages =
        companyTotal === 0 ? 0 : Math.ceil(companyTotal / pageSize);
      return {
        success: true as const,
        data,
        pagination: {
          total: companyTotal,
          totalJobs: jobTotal,
          unit: 'companies' as const,
          page,
          limit: pageSize,
          totalPages,
        },
        statusCounts: tabCounts,
        hasMore: page * pageSize < companyTotal,
        nextCursor: null,
      };
    }

    const catalogForCounts = unfiltered
      ? await this.catalogTotal.getUnfiltered()
      : peekJobs;

    const [filtered, tabCounts] = await Promise.all([
      this.companyList.listFiltered(
        query,
        page,
        pageSize,
        profileId,
        idConstraint,
      ),
      this.jobStatuses.tabCounts(
        profileId,
        unfiltered ? catalogForCounts : peekJobs,
      ),
    ]);

    if (unfiltered && tabCounts.all !== catalogForCounts) {
      tabCounts.all = catalogForCounts;
    } else if (!unfiltered) {
      // Filtered "all" badge uses matching job count for this request when on All tab.
      // Status tabs keep aggregation-based badges; override only the list total.
      if (status === 'all') {
        tabCounts.all = filtered.jobTotal;
      }
    }

    const totalPages =
      filtered.companyTotal === 0
        ? 0
        : Math.ceil(filtered.companyTotal / pageSize);
    return {
      success: true as const,
      data: filtered.data,
      pagination: {
        total: filtered.companyTotal,
        totalJobs: filtered.jobTotal,
        unit: 'companies' as const,
        page,
        limit: pageSize,
        totalPages,
      },
      statusCounts: tabCounts,
      hasMore: page * pageSize < filtered.companyTotal,
      nextCursor: null,
    };
  }

  private async statusIdConstraint(
    status: JobStatusTab,
    profileId: string,
  ): Promise<JobsIdConstraint> {
    if (status === 'all') return null;
    if (!profileId) return { includeIds: [] };

    if (status === 'posted') {
      const excludeIds = await this.jobStatuses.jobIdsWithAnyStatus(profileId);
      return { excludeIds };
    }

    const includeIds = await this.jobStatuses.jobIdsForState(profileId, status);
    return { includeIds };
  }

  private emptyPage(
    page: number,
    pageSize: number,
    statusCounts: Record<JobStatusTab, number> = EMPTY_STATUS_COUNTS,
  ) {
    return {
      success: true as const,
      data: [] as Record<string, unknown>[],
      pagination: {
        total: 0,
        totalJobs: 0,
        unit: 'companies' as const,
        page,
        limit: pageSize,
        totalPages: 0,
      },
      statusCounts,
      hasMore: false,
      nextCursor: null,
    };
  }
}
