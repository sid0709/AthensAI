import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  isInconsistentDateTime,
  repairNullDateFields,
  repairStringDateFields,
} from '../../prisma/mongo-standalone';
import { PrismaService } from '../../prisma/prisma.service';
import { JOB_OBJECT_ID_PATTERN } from '../lib/normalize-job-ids';
import {
  hasStoredRecommendation,
  mapVendorTaskRecommendFields,
  type JobRecommendFields,
} from './job-recommend-fields.mapper';

const VENDOR_TASKS_COLLECTION = 'vendor_tasks';

const RECOMMEND_SELECT = {
  jobId: true,
  recommendedResumeStack: true,
  recommendedResumeId: true,
  recommendedResumeReason: true,
  useCustomizedResume: true,
  recommendWarning: true,
  recommendedAt: true,
  recommendMode: true,
} as const;

type RecommendRow = {
  jobId: string;
  recommendedResumeStack: string | null;
  recommendedResumeId: string | null;
  recommendedResumeReason: string | null;
  useCustomizedResume: boolean;
  recommendWarning: string | null;
  recommendedAt: Date | string | null;
  recommendMode: string | null;
};

function asJobIdHex(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    const id = value.trim();
    return JOB_OBJECT_ID_PATTERN.test(id) ? id : null;
  }
  if (typeof value === 'object') {
    const raw = value as { $oid?: string; toHexString?: () => string };
    if (typeof raw.$oid === 'string' && JOB_OBJECT_ID_PATTERN.test(raw.$oid)) {
      return raw.$oid.trim();
    }
    if (typeof raw.toHexString === 'function') {
      const hex = raw.toHexString();
      if (typeof hex === 'string' && JOB_OBJECT_ID_PATTERN.test(hex)) {
        return hex.trim();
      }
    }
  }
  return null;
}

function extractFindBatch(raw: unknown): unknown[] {
  if (!raw || typeof raw !== 'object') return [];
  const doc = raw as {
    cursor?: { firstBatch?: unknown[] };
    firstBatch?: unknown[];
  };
  if (Array.isArray(doc.cursor?.firstBatch)) return doc.cursor.firstBatch;
  if (Array.isArray(doc.firstBatch)) return doc.firstBatch;
  return [];
}

function remember(
  out: Map<string, JobRecommendFields>,
  jobId: string,
  fields: JobRecommendFields,
) {
  const raw = String(jobId || '').trim();
  if (!raw) return;
  out.set(raw, fields);
  out.set(raw.toLowerCase(), fields);
}

/**
 * Load Library / customized resume recommendations from vendor_tasks
 * for Job Search list + detail hydration.
 */
@Injectable()
export class JobRecommendFieldsService {
  constructor(private readonly prisma: PrismaService) {}

  async loadForProfile(
    profileId: string,
    jobIds: string[],
  ): Promise<Map<string, JobRecommendFields>> {
    const out = new Map<string, JobRecommendFields>();
    const id = String(profileId || '').trim();
    const ids = [
      ...new Set(
        jobIds
          .map((jobId) => String(jobId || '').trim())
          .filter((jobId) => JOB_OBJECT_ID_PATTERN.test(jobId)),
      ),
    ];
    if (!id || !ids.length) return out;

    const account = await this.prisma.accountInfo.findUnique({
      where: { id },
      select: { name: true },
    });
    if (!account?.name) return out;
    return this.loadForApplier(account.name, ids);
  }

  async loadForApplier(
    applierName: string,
    jobIds: string[],
  ): Promise<Map<string, JobRecommendFields>> {
    const out = new Map<string, JobRecommendFields>();
    const name = String(applierName || '').trim();
    const ids = [
      ...new Set(
        jobIds
          .map((jobId) => String(jobId || '').trim())
          .filter((jobId) => JOB_OBJECT_ID_PATTERN.test(jobId)),
      ),
    ];
    if (!name || !ids.length) return out;

    const rows = await this.findRecommendRows(name, ids);
    for (const row of rows) {
      if (!hasStoredRecommendation(row)) continue;
      const jobId = asJobIdHex(row.jobId) || String(row.jobId || '').trim();
      if (!jobId) continue;
      remember(out, jobId, mapVendorTaskRecommendFields(row));
    }
    return out;
  }

  private async findRecommendRows(
    applierName: string,
    jobIds: string[],
  ): Promise<RecommendRow[]> {
    const byJobId = new Map<string, RecommendRow>();

    const absorb = (rows: RecommendRow[]) => {
      for (const row of rows) {
        const jobId = asJobIdHex(row.jobId) || String(row.jobId || '').trim();
        if (!jobId) continue;
        byJobId.set(jobId.toLowerCase(), { ...row, jobId });
      }
    };

    try {
      absorb(
        (await this.prisma.vendorTask.findMany({
          where: { applierName, jobId: { in: jobIds } },
          select: RECOMMEND_SELECT,
        })) as RecommendRow[],
      );
    } catch (error) {
      if (!isInconsistentDateTime(error)) throw error;
      await this.repairVendorTaskDates();
      absorb(
        (await this.prisma.vendorTask.findMany({
          where: { applierName, jobId: { in: jobIds } },
          select: RECOMMEND_SELECT,
        })) as RecommendRow[],
      );
    }

    const missing = jobIds.filter(
      (id) => !byJobId.has(String(id).toLowerCase()),
    );
    // Legacy rows may store jobId as ObjectId; Prisma String `in` misses those.
    if (missing.length > 0 || byJobId.size === 0) {
      absorb(await this.findRecommendRowsRaw(applierName, missing.length ? missing : jobIds));
    }

    return [...byJobId.values()];
  }

  private async findRecommendRowsRaw(
    applierName: string,
    jobIds: string[],
  ): Promise<RecommendRow[]> {
    const stringIds = [...new Set(jobIds.flatMap((id) => [id, id.toLowerCase()]))];
    const objectIds = stringIds.map((id) => ({ $oid: id }));

    const raw = await this.prisma.$runCommandRaw({
      find: VENDOR_TASKS_COLLECTION,
      filter: {
        applierName,
        $or: [
          { jobId: { $in: stringIds } },
          { jobId: { $in: objectIds } },
        ],
      } as Prisma.InputJsonValue,
      projection: {
        jobId: 1,
        recommendedResumeStack: 1,
        recommendedResumeId: 1,
        recommendedResumeReason: 1,
        useCustomizedResume: 1,
        recommendWarning: 1,
        recommendedAt: 1,
        recommendMode: 1,
      },
      limit: Math.max(stringIds.length * 2, 50),
    });

    return extractFindBatch(raw).map((doc) => {
      const row = (doc || {}) as Record<string, unknown>;
      const recommendedAtRaw = row.recommendedAt;
      let recommendedAt: Date | string | null = null;
      if (recommendedAtRaw instanceof Date) {
        recommendedAt = recommendedAtRaw;
      } else if (
        recommendedAtRaw &&
        typeof recommendedAtRaw === 'object' &&
        '$date' in (recommendedAtRaw as object)
      ) {
        recommendedAt = String(
          (recommendedAtRaw as { $date: string }).$date || '',
        );
      } else if (typeof recommendedAtRaw === 'string') {
        recommendedAt = recommendedAtRaw;
      }

      const resumeId = asJobIdHex(row.recommendedResumeId);

      return {
        jobId: asJobIdHex(row.jobId) || String(row.jobId || ''),
        recommendedResumeStack:
          typeof row.recommendedResumeStack === 'string'
            ? row.recommendedResumeStack
            : null,
        recommendedResumeId: resumeId,
        recommendedResumeReason:
          typeof row.recommendedResumeReason === 'string'
            ? row.recommendedResumeReason
            : null,
        useCustomizedResume: Boolean(row.useCustomizedResume),
        recommendWarning:
          typeof row.recommendWarning === 'string' ? row.recommendWarning : null,
        recommendedAt,
        recommendMode:
          typeof row.recommendMode === 'string' ? row.recommendMode : null,
      };
    });
  }

  private async repairVendorTaskDates(): Promise<void> {
    await repairStringDateFields(this.prisma, VENDOR_TASKS_COLLECTION, [
      'recommendedAt',
      'addedAt',
      'bidReadyDate',
      'createdAt',
      'updatedAt',
    ]);
    await repairNullDateFields(this.prisma, VENDOR_TASKS_COLLECTION, [
      'createdAt',
      'updatedAt',
      'addedAt',
    ]);
  }
}
