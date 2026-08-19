import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { JOB_OBJECT_ID_PATTERN } from '../../jobs/lib/normalize-job-ids';
import { JobRecommendFieldsService } from '../../jobs/recommend/job-recommend-fields.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ResumeService } from '../../resumes/resume.service';
import { OAK_RECOMMENDED_RESUME_KEY } from '../constants/oak.constants';
import { OakRecommendedResumeLookup } from './oak-recommended-resume.lookup';
import {
  assignedResumeStack,
  type OakRecommendAssignment,
} from './oak-recommended-resume.resolve';

type ResolvedResumeJob = {
  account: { id: string; name: string };
  resumeId: string;
  recommend: OakRecommendAssignment;
};

@Injectable()
export class OakRecommendedResumeService {
  private readonly logger = new Logger(OakRecommendedResumeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly recommendFields: JobRecommendFieldsService,
    private readonly resumes: ResumeService,
    private readonly lookup: OakRecommendedResumeLookup,
  ) {}

  async getForJob(applierName: string, jobId: string) {
    const id = String(jobId || '').trim();
    if (!JOB_OBJECT_ID_PATTERN.test(id)) {
      throw new BadRequestException({
        success: false,
        error: 'Invalid job id',
      });
    }

    const resolved = await this.resolveForJob(applierName, id);
    const detail = await this.resumes.get(
      resolved.resumeId,
      resolved.account.name,
    );
    if (!detail.contentBase64) {
      throw new NotFoundException({
        success: false,
        error: 'Recommended resume file is missing from storage',
      });
    }

    const stack =
      String(detail.techStack || '').trim() ||
      assignedResumeStack(resolved.recommend) ||
      null;
    this.logger.log(
      `recommended resume job=${id} resume=${detail.id} stack=${stack || 'n/a'}`,
    );

    return {
      success: true as const,
      jobId: id,
      resumeId: detail.id,
      stack,
      file: {
        key: OAK_RECOMMENDED_RESUME_KEY,
        name: detail.fileName,
        mimeType: detail.mimeType || 'application/octet-stream',
        base64: detail.contentBase64,
      },
    };
  }

  /** True when a Worker-pool job has an assigned Library file (no download). */
  async existsForJob(applierName: string, jobId: string): Promise<boolean> {
    const id = String(jobId || '').trim();
    if (!JOB_OBJECT_ID_PATTERN.test(id)) return false;
    try {
      const resolved = await this.resolveForJob(applierName, id);
      const row = await this.resumes.findOwned(
        resolved.resumeId,
        resolved.account.name,
      );
      return Boolean(String(row.storagePath || '').trim());
    } catch (err) {
      if (
        err instanceof NotFoundException ||
        err instanceof BadRequestException
      ) {
        return false;
      }
      throw err;
    }
  }

  private async resolveForJob(
    applierName: string,
    id: string,
  ): Promise<ResolvedResumeJob> {
    const account = await this.prisma.accountInfo.findUnique({
      where: { name: applierName },
      select: { id: true, name: true },
    });
    if (!account) {
      throw new NotFoundException({
        success: false,
        error: 'Account not found',
      });
    }

    const status = await this.prisma.jobStatus.findFirst({
      where: { profileId: account.id, jobId: id, state: 'worker-pool' },
      select: { jobId: true },
    });
    if (!status) {
      throw new NotFoundException({
        success: false,
        error: 'Job is not in Worker pool',
      });
    }

    const byJob = await this.recommendFields.loadForApplier(account.name, [id]);
    const recommend = byJob.get(id) || byJob.get(id.toLowerCase()) || null;
    const resumeId = await this.lookup.resolveId(
      account.id,
      account.name,
      recommend,
    );
    return { account, resumeId, recommend };
  }
}
