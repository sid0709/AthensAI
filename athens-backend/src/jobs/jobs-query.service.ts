import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { ListJobsQueryDto } from './dto/list-jobs.query.dto';
import {
  EMPTY_STATUS_COUNTS,
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_MAX,
  type JobStatusTab,
} from './constants/job-list.constants';
import { JobStatusCountsService } from './job-status-counts.service';
import { JobStatusService } from './job-status.service';
import { mapJobToListDoc } from './mappers/job-list.mapper';

function parseSources(raw: string | undefined): string[] {
  const text = String(raw ?? '').trim();
  if (!text || text === 'all') return [];
  return [
    ...new Set(
      text
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
}

function parseDayStart(isoDate: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!match) return null;
  const d = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseDayEnd(isoDate: string): Date | null {
  const start = parseDayStart(isoDate);
  if (!start) return null;
  return new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
}

@Injectable()
export class JobsQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly statusCounts: JobStatusCountsService,
    private readonly jobStatuses: JobStatusService,
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
      const counts = await this.statusCounts.getTabCounts(profileId, 0);
      return this.emptyPage(page, pageSize, counts);
    }

    const where = this.buildWhere(query);
    const [total, rows] = await Promise.all([
      this.prisma.job.count({ where }),
      this.prisma.job.findMany({
        where,
        orderBy: { postedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const [tabCounts, stateByJobId] = await Promise.all([
      this.statusCounts.getTabCounts(profileId, total),
      this.jobStatuses.statesForJobs(
        profileId,
        rows.map((row) => row.id),
      ),
    ]);

    const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
    return {
      success: true as const,
      data: rows.map((row) =>
        mapJobToListDoc(row, stateByJobId.get(row.id) || 'posted'),
      ),
      pagination: {
        total,
        totalJobs: total,
        unit: 'jobs' as const,
        page,
        limit: pageSize,
        totalPages,
      },
      statusCounts: tabCounts,
      hasMore: page * pageSize < total,
      nextCursor: null,
    };
  }

  private buildWhere(query: ListJobsQueryDto): Prisma.JobWhereInput {
    const where: Prisma.JobWhereInput = {};
    const q = String(query.q ?? '').trim();
    if (q) {
      where.title = { contains: q, mode: 'insensitive' };
    }

    const company = String(query.company ?? '').trim();
    if (company) {
      where.companyName = { contains: company, mode: 'insensitive' };
    }

    const sources = parseSources(query.source);
    if (sources.length) {
      where.source = { in: sources };
    }

    const from = query.postedFrom ? parseDayStart(query.postedFrom) : null;
    const to = query.postedTo ? parseDayEnd(query.postedTo) : null;
    if (from || to) {
      where.postedAt = {
        ...(from ? { gte: from } : {}),
        ...(to ? { lte: to } : {}),
      };
    }

    if (query.aiExtracted) {
      where.aiSkillStatus = 'extracted';
    }

    return where;
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
        unit: 'jobs' as const,
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
