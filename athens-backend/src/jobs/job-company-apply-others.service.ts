import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  objectIdIn,
  rawInsertMany,
  rawUpdateMany,
  withReplicaSetFallback,
} from '../prisma/mongo-standalone';
import {
  JOB_STATUS_STATES,
  type JobStatusState,
} from './constants/job-status-states.constants';

const OBJECT_ID_RE = /^[a-f\d]{24}$/i;
const MAX_APPLY = 500;
const JOB_STATUSES_COLLECTION = 'job_statuses';
const SKIP_ALWAYS = new Set<JobStatusState>([
  'applied',
  'scheduled',
  'declined',
]);
const SKIP_QUEUED = new Set<JobStatusState>([
  'bid-ready',
  'worker-pool',
  'bid-completed',
]);

@Injectable()
export class JobCompanyApplyOthersService {
  constructor(private readonly prisma: PrismaService) {}

  async applyOthers(input: {
    applierName: string;
    companyId: string;
    keepJobIds: string[];
    includeQueued?: boolean;
  }) {
    const applierName = String(input.applierName || '').trim();
    if (!applierName) {
      throw new BadRequestException({
        success: false,
        error: 'applierName is required',
      });
    }

    const account = await this.prisma.accountInfo.findUnique({
      where: { name: applierName },
      select: { id: true },
    });
    if (!account) {
      throw new NotFoundException({
        success: false,
        error: `User ${applierName} not found`,
      });
    }

    const keep = new Set(
      (Array.isArray(input.keepJobIds) ? input.keepJobIds : [])
        .map((id) => String(id || '').trim())
        .filter((id) => OBJECT_ID_RE.test(id)),
    );
    const companyId = await this.resolveCompanyId(input.companyId, keep);
    const targets = await this.siblingJobIds(companyId, keep);
    if (!targets.length) {
      return { success: true as const, appliedCount: 0, appliedIds: [] as string[] };
    }

    const statuses = await this.prisma.jobStatus.findMany({
      where: { profileId: account.id, jobId: { in: targets } },
      select: { jobId: true, state: true },
    });
    const includeQueued = input.includeQueued === true;
    const existing = new Map(statuses.map((row) => [row.jobId, row.state]));
    const toUpdate: string[] = [];
    const toInsert: string[] = [];
    for (const jobId of targets) {
      const state = existing.get(jobId);
      if (state != null && isSkipState(state, includeQueued)) continue;
      if (state == null) toInsert.push(jobId);
      else toUpdate.push(jobId);
    }

    const now = new Date();
    if (toUpdate.length) {
      await withReplicaSetFallback(
        async () => {
          await this.prisma.jobStatus.updateMany({
            where: { profileId: account.id, jobId: { in: toUpdate } },
            data: { state: 'applied' },
          });
        },
        async () => {
          await rawUpdateMany(
            this.prisma,
            JOB_STATUSES_COLLECTION,
            {
              profileId: { $oid: account.id },
              jobId: objectIdIn(toUpdate),
            },
            { state: 'applied', updatedAt: now },
          );
        },
      );
    }
    if (toInsert.length) {
      await rawInsertMany(
        this.prisma,
        JOB_STATUSES_COLLECTION,
        toInsert.map((jobId) => ({
          profileId: { $oid: account.id },
          jobId: { $oid: jobId },
          state: 'applied',
          createdAt: now,
          updatedAt: now,
        })),
      );
    }

    const appliedIds = [...toUpdate, ...toInsert];
    return {
      success: true as const,
      appliedCount: appliedIds.length,
      appliedIds,
    };
  }

  private async resolveCompanyId(raw: string, keep: Set<string>): Promise<string> {
    const companyId = String(raw || '').trim();
    if (OBJECT_ID_RE.test(companyId)) return companyId;
    const keepId = [...keep][0];
    if (!keepId) {
      throw new BadRequestException({
        success: false,
        error: 'Invalid company id',
      });
    }
    const job = await this.prisma.job.findUnique({
      where: { id: keepId },
      select: { companyId: true },
    });
    const resolved = String(job?.companyId || '').trim();
    if (!OBJECT_ID_RE.test(resolved)) {
      throw new BadRequestException({
        success: false,
        error: 'Invalid company id',
      });
    }
    return resolved;
  }

  private async siblingJobIds(companyId: string, keep: Set<string>): Promise<string[]> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { jobIds: true },
    });
    let ids = (company?.jobIds ?? [])
      .map((id) => String(id || '').trim())
      .filter((id) => OBJECT_ID_RE.test(id) && !keep.has(id))
      .slice(0, MAX_APPLY);
    if (!ids.length) {
      const rows = await this.prisma.job.findMany({
        where: { companyId, NOT: { sourceCatalog: 'external' } },
        select: { id: true },
        take: MAX_APPLY,
      });
      return rows.map((row) => row.id).filter((id) => !keep.has(id));
    }
    const rows = await this.prisma.job.findMany({
      where: { id: { in: ids }, NOT: { sourceCatalog: 'external' } },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }
}

function isSkipState(
  raw: string | null | undefined,
  includeQueued: boolean,
): boolean {
  const state = String(raw || '').trim();
  if (!(JOB_STATUS_STATES as readonly string[]).includes(state)) return false;
  const typed = state as JobStatusState;
  if (SKIP_ALWAYS.has(typed)) return true;
  return !includeQueued && SKIP_QUEUED.has(typed);
}
