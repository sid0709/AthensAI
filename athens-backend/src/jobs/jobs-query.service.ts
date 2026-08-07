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
import { JobStatusCountsService } from './job-status-counts.service';
import { JobsCompanyListService } from './jobs-company-list.service';
import { buildJobsPrismaWhere, isEmptyWhere } from './lib/jobs-where';

@Injectable()
export class JobsQueryService {
  constructor(
    private readonly catalogTotal: JobCatalogTotalService,
    private readonly companyCatalogTotal: CompanyCatalogTotalService,
    private readonly statusCounts: JobStatusCountsService,
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

    // Status tabs other than All need job_statuses joins — not wired yet.
    if (status !== 'all') {
      const peekJobs = this.catalogTotal.peek() ?? 0;
      const counts = await this.statusCounts.getTabCounts(profileId, peekJobs);
      return this.emptyPage(page, pageSize, counts);
    }

    const where = buildJobsPrismaWhere(query);
    const unfiltered = isEmptyWhere(where);
    const peekJobs = unfiltered ? (this.catalogTotal.peek() ?? 0) : 0;

    if (unfiltered) {
      const [companyTotal, jobTotal, data, tabCounts] = await Promise.all([
        this.companyCatalogTotal.getUnfiltered(),
        this.catalogTotal.getUnfiltered(),
        this.companyList.listUnfiltered(page, pageSize, profileId),
        this.statusCounts.getTabCounts(profileId, peekJobs),
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

    const [filtered, tabCounts] = await Promise.all([
      this.companyList.listFiltered(query, page, pageSize, profileId),
      this.statusCounts.getTabCounts(profileId, peekJobs),
    ]);

    // Filtered "all" badge uses matching job count for this request.
    tabCounts.all = filtered.jobTotal;

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
