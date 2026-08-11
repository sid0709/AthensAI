import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { COMPANY_MEMBERS_PAGE_SIZE } from './constants/job-list.constants';
import { JOB_LIST_SELECT } from './constants/job-list.select';
import type { ListJobsQueryDto } from './dto/list-jobs.query.dto';
import {
  buildJobsMongoMatch,
  type JobsIdConstraint,
} from './lib/jobs-mongo-match';
import {
  mapCompanyGroupRow,
  type CompanyGroupSource,
} from './mappers/company-group.mapper';
import { JobStatusService } from './job-status.service';
import { JobRecommendFieldsService } from './recommend/job-recommend-fields.service';

type AggregateFacetRow = {
  totals?: Array<{ companies?: number; jobs?: number }>;
  page?: Array<{
    _id?: unknown;
    matchingJobIds?: unknown[];
    matchingCount?: number;
  }>;
};

function asObjectIdHex(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string' && /^[a-fA-F0-9]{24}$/.test(value)) {
    return value;
  }
  if (typeof value !== 'object') return null;
  const raw = value as {
    $oid?: string;
    toHexString?: () => string;
  };
  if (typeof raw.$oid === 'string' && /^[a-fA-F0-9]{24}$/.test(raw.$oid)) {
    return raw.$oid;
  }
  if (typeof raw.toHexString === 'function') {
    const hex = raw.toHexString();
    if (typeof hex === 'string' && /^[a-fA-F0-9]{24}$/.test(hex)) return hex;
  }
  return null;
}

function extractFirstBatch(raw: unknown): unknown[] {
  if (!raw || typeof raw !== 'object') return [];
  const doc = raw as {
    cursor?: { firstBatch?: unknown[] };
    firstBatch?: unknown[];
  };
  if (Array.isArray(doc.cursor?.firstBatch)) return doc.cursor.firstBatch;
  if (Array.isArray(doc.firstBatch)) return doc.firstBatch;
  return [];
}

@Injectable()
export class JobsCompanyListService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobStatuses: JobStatusService,
    private readonly recommendFields: JobRecommendFieldsService,
  ) {}

  /** Unfiltered: page companies by lastPostedAt, hydrate first N jobIds. */
  async listUnfiltered(page: number, pageSize: number, profileId: string) {
    const companies = await this.prisma.company.findMany({
      orderBy: { lastPostedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    const groups: CompanyGroupSource[] = companies.map((row) => ({
      companyId: row.id,
      companyName: row.companyName,
      companyLogo: row.companyLogo,
      companyUrl: row.companyUrl,
      matchingJobCount: row.jobCount,
      matchingJobIds: row.jobIds,
    }));

    return this.hydrateGroups(groups, profileId);
  }

  /**
   * Filtered: aggregate matching jobs by companyId, page groups, hydrate.
   * Returns { data, companyTotal, jobTotal }.
   */
  async listFiltered(
    query: ListJobsQueryDto,
    page: number,
    pageSize: number,
    profileId: string,
    idConstraint: JobsIdConstraint = null,
  ) {
    if (
      idConstraint &&
      'includeIds' in idConstraint &&
      idConstraint.includeIds.length === 0
    ) {
      return {
        data: [] as Record<string, unknown>[],
        companyTotal: 0,
        jobTotal: 0,
      };
    }

    const match = buildJobsMongoMatch(query, idConstraint);
    const skip = (page - 1) * pageSize;

    const raw = await this.prisma.$runCommandRaw({
      aggregate: 'jobs',
      pipeline: [
        { $match: match },
        { $sort: { postedAt: -1 } },
        {
          $group: {
            _id: '$companyId',
            lastPostedAt: { $max: '$postedAt' },
            matchingJobIds: { $push: '$_id' },
            matchingCount: { $sum: 1 },
          },
        },
        { $sort: { lastPostedAt: -1 } },
        {
          $facet: {
            totals: [
              {
                $group: {
                  _id: null,
                  companies: { $sum: 1 },
                  jobs: { $sum: '$matchingCount' },
                },
              },
            ],
            page: [{ $skip: skip }, { $limit: pageSize }],
          },
        },
      ] as Prisma.InputJsonValue[],
      cursor: {},
    });

    const batch = extractFirstBatch(raw);
    const facet = (batch[0] || {}) as AggregateFacetRow;
    const totals = facet.totals?.[0];
    const companyTotal = Number(totals?.companies || 0);
    const jobTotal = Number(totals?.jobs || 0);

    const pageRows = Array.isArray(facet.page) ? facet.page : [];
    const companyIds = pageRows
      .map((row) => asObjectIdHex(row._id))
      .filter((id): id is string => Boolean(id));

    const companyDocs =
      companyIds.length === 0
        ? []
        : await this.prisma.company.findMany({
            where: { id: { in: companyIds } },
          });
    const companyById = new Map(companyDocs.map((row) => [row.id, row]));

    const groups: CompanyGroupSource[] = [];
    for (const row of pageRows) {
      const companyId = asObjectIdHex(row._id);
      if (!companyId) continue;
      const company = companyById.get(companyId);
      const matchingJobIds = (row.matchingJobIds || [])
        .map((id) => asObjectIdHex(id))
        .filter((id): id is string => Boolean(id));
      const matchingJobCount = Number(
        row.matchingCount || matchingJobIds.length,
      );
      groups.push({
        companyId,
        companyName: company?.companyName || 'Unknown',
        companyLogo: company?.companyLogo,
        companyUrl: company?.companyUrl,
        matchingJobCount,
        matchingJobIds,
      });
    }

    const data = await this.hydrateGroups(groups, profileId);
    return { data, companyTotal, jobTotal };
  }

  private async hydrateGroups(
    groups: CompanyGroupSource[],
    profileId: string,
  ): Promise<Record<string, unknown>[]> {
    const memberIds = [
      ...new Set(
        groups.flatMap((group) =>
          group.matchingJobIds.slice(0, COMPANY_MEMBERS_PAGE_SIZE),
        ),
      ),
    ];

    const jobs =
      memberIds.length === 0
        ? []
        : await this.prisma.job.findMany({
            where: { id: { in: memberIds } },
            select: JOB_LIST_SELECT,
          });

    const stateByJobId = await this.jobStatuses.statesForJobs(
      profileId,
      memberIds,
    );

    const recommendByJobId = await this.recommendFields.loadForProfile(
      profileId,
      memberIds,
    );

    return groups.map((group) => {
      const row = mapCompanyGroupRow(group, jobs, stateByJobId);
      const jobsOut = Array.isArray(row.jobs) ? row.jobs : [];
      row.jobs = jobsOut.map((job) => {
        const id = String((job as { _id?: string })._id || '');
        const recommend =
          recommendByJobId.get(id) || recommendByJobId.get(id.toLowerCase());
        if (!recommend) return job;
        return { ...job, ...recommend };
      });
      return row;
    });
  }
}
