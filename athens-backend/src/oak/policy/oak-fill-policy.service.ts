import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  OAK_FILL_RESUME_REQUIRED_CODE,
  OAK_FILL_RESUME_REQUIRED_MESSAGE,
  OAK_NON_ADMIN_ACTION_TEMPERATURE,
} from '../constants/oak-admin.constants';
import { OakRecommendedResumeService } from '../http/oak-recommended-resume.service';
import { jobIdFromPage, withRecommendedResumeAvailable } from './analyze-page';
import { applyActionTemperature } from './apply-action-temperature';
import { OakAdminPrivilegesService } from './oak-admin-privileges.service';

export type OakFillAnalyzePolicy = {
  isAdmin: boolean;
  recommendedResumeAvailable: boolean;
  page: Record<string, unknown>;
};

@Injectable()
export class OakFillPolicyService {
  constructor(
    private readonly admin: OakAdminPrivilegesService,
    private readonly recommendedResume: OakRecommendedResumeService,
  ) {}

  async resolveForAnalyze(input: {
    applierName: string;
    page?: unknown;
  }): Promise<OakFillAnalyzePolicy> {
    const isAdmin = await this.admin.isAdmin(input.applierName);
    const jobId = jobIdFromPage(input.page);
    const recommendedResumeAvailable = jobId
      ? await this.recommendedResume.existsForJob(input.applierName, jobId)
      : false;

    if (!isAdmin && !recommendedResumeAvailable) {
      throw new ForbiddenException({
        success: false,
        code: OAK_FILL_RESUME_REQUIRED_CODE,
        error: OAK_FILL_RESUME_REQUIRED_MESSAGE,
        message: OAK_FILL_RESUME_REQUIRED_MESSAGE,
      });
    }

    return {
      isAdmin,
      recommendedResumeAvailable,
      page: withRecommendedResumeAvailable(
        input.page,
        recommendedResumeAvailable,
      ),
    };
  }

  applyPlanPolicy(plan: unknown, isAdmin: boolean): unknown {
    if (isAdmin) return plan;
    return applyActionTemperature(plan, OAK_NON_ADMIN_ACTION_TEMPERATURE);
  }
}
