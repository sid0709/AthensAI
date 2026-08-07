import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AthensMetadataService } from './athens-metadata.service';
import {
  ATHENS_METADATA_QUEUES,
  TITLE_REVIEW_META_STATES,
  type TitleReviewMetaState,
} from './constants/athens-metadata.constants';
import type { ListTitleReviewQueryDto } from './dto/list-title-review.query.dto';
import { mapJobToTitleReviewRow } from './mappers/title-review.mapper';

const TITLE_REVIEW_JOB_SELECT = {
  id: true,
  title: true,
  companyName: true,
  source: true,
  postedAt: true,
  applyLink: true,
  titleReviewLabel: true,
  metadata: true,
} as const satisfies Prisma.JobSelect;

function tabToState(tab: string): TitleReviewMetaState {
  if (tab === 'review_required')
    return TITLE_REVIEW_META_STATES.REVIEW_REQUIRED;
  if (tab === 'failed') return TITLE_REVIEW_META_STATES.FAILED;
  return TITLE_REVIEW_META_STATES.PENDING;
}

@Injectable()
export class TitleReviewQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metadata: AthensMetadataService,
  ) {}

  async status() {
    const counts = await this.metadata.titleReviewCounts();
    return {
      success: true as const,
      running: false,
      status: 'idle' as const,
      ...counts,
    };
  }

  async list(query: ListTitleReviewQueryDto) {
    const started = Date.now();
    const tab = String(query.tab || 'unreviewed').trim();
    const state = tabToState(tab);
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(500, Math.max(1, query.limit ?? 50));
    const q = String(query.q ?? '').trim();
    const sort = String(query.sort || 'newest').trim();

    const membership = await this.metadata.listJobIds(
      ATHENS_METADATA_QUEUES.TITLE_REVIEW,
      state,
    );
    const jobIds = membership.map((row) => row.jobId);
    const counts = await this.metadata.titleReviewCounts();

    if (!jobIds.length) {
      return this.emptyList(page, limit, counts, started);
    }

    const where: Prisma.JobWhereInput = {
      id: { in: jobIds },
      ...(q ? { title: { contains: q, mode: 'insensitive' as const } } : {}),
    };

    const orderBy: Prisma.JobOrderByWithRelationInput =
      sort === 'oldest' ? { postedAt: 'asc' } : { postedAt: 'desc' };

    const [total, rows] = await Promise.all([
      this.prisma.job.count({ where }),
      this.prisma.job.findMany({
        where,
        select: TITLE_REVIEW_JOB_SELECT,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
    return {
      success: true as const,
      data: rows.map((row) => mapJobToTitleReviewRow(row, state)),
      counts,
      pagination: { page, limit, total, totalPages },
      meta: {
        cacheSource: 'memory' as const,
        revision: `athens-metadata:${state}:${total}`,
        stale: false,
        serverDurationMs: Date.now() - started,
        returnedRows: rows.length,
      },
    };
  }

  async bootstrap(query: ListTitleReviewQueryDto) {
    const [session, list] = await Promise.all([
      this.status(),
      this.list(query),
    ]);
    return { ...list, session };
  }

  private emptyList(
    page: number,
    limit: number,
    counts: Awaited<ReturnType<AthensMetadataService['titleReviewCounts']>>,
    started: number,
  ) {
    return {
      success: true as const,
      data: [] as ReturnType<typeof mapJobToTitleReviewRow>[],
      counts,
      pagination: { page, limit, total: 0, totalPages: 0 },
      meta: {
        cacheSource: 'memory' as const,
        revision: 'athens-metadata:empty',
        stale: false,
        serverDurationMs: Date.now() - started,
        returnedRows: 0,
      },
    };
  }
}
