import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JobStatusMutateService } from './job-status-mutate.service';
import {
  JOB_STATUS_STATES,
  type JobStatusState,
} from './constants/job-status-states.constants';

const OBJECT_ID_RE = /^[a-f\d]{24}$/i;
const MAX_APPLY = 500;
/** Never overwrite these; they are already past apply. */
const SKIP_ALWAYS = new Set<JobStatusState>([
  'applied',
  'scheduled',
  'declined',
]);
/** Leave queue states alone unless includeQueued (Worker pool sibling path). */
const SKIP_QUEUED = new Set<JobStatusState>([
  'bid-ready',
  'worker-pool',
  'bid-completed',
]);

@Injectable()
export class JobCompanyApplyOthersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mutate: JobStatusMutateService,
  ) {}

  async applyOthers(input: {
    applierName: string;
    companyId: string;
    keepJobIds: string[];
    includeQueued?: boolean;
    mutationId?: string;
  }) {
    const applierName = String(input.applierName || '').trim();
    const companyId = String(input.companyId || '').trim();
    if (!applierName) {
      throw new BadRequestException({
        success: false,
        error: 'applierName is required',
      });
    }
    if (!OBJECT_ID_RE.test(companyId)) {
      throw new BadRequestException({
        success: false,
        error: 'Invalid company id',
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

    const rows = await this.prisma.job.findMany({
      where: { companyId, NOT: { sourceCatalog: 'external' } },
      select: { id: true },
      take: MAX_APPLY + keep.size,
    });
    const targets = rows
      .map((row) => row.id)
      .filter((id) => !keep.has(id))
      .slice(0, MAX_APPLY);

    if (!targets.length) {
      return { success: true as const, appliedCount: 0, appliedIds: [] as string[] };
    }

    const statuses = await this.prisma.jobStatus.findMany({
      where: { profileId: account.id, jobId: { in: targets } },
      select: { jobId: true, state: true },
    });
    const includeQueued = input.includeQueued === true;
    const skip = new Set(
      statuses
        .filter((row) => isSkipState(row.state, includeQueued))
        .map((row) => row.jobId),
    );

    const appliedIds: string[] = [];
    for (const jobId of targets) {
      if (skip.has(jobId)) continue;
      const result = await this.mutate.apply(
        jobId,
        applierName,
        input.mutationId,
      );
      if (result.success) appliedIds.push(jobId);
    }

    return {
      success: true as const,
      appliedCount: appliedIds.length,
      appliedIds,
    };
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
