import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AiUsageModule } from '../ai-usage/ai-usage.module';
import { AuthModule } from '../auth/auth.module';
import { JobsModule } from '../jobs/jobs.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ResumesModule } from '../resumes/resumes.module';
import { OakAuthController } from './auth/oak-auth.controller';
import { OakAuthGuard } from './auth/oak-auth.guard';
import { OakAuthService } from './auth/oak-auth.service';
import { OakSessionService } from './auth/oak-session.service';
import { OakAnalyzeService } from './ai/oak-analyze.service';
import { OakIdentityService } from './ai/oak-identity.service';
import { OakMatchOptionService } from './ai/oak-match-option.service';
import { OakProseService } from './ai/oak-prose.service';
import { OakProfilePromptService } from './ai/oak-profile-prompt.service';
import { OakResponsesService } from './ai/oak-responses.service';
import { OakGatewayBootstrap } from './gateway/oak-gateway.bootstrap';
import { OakController } from './http/oak.controller';
import { OakJobsMarkAppliedService } from './http/oak-jobs-mark-applied.service';
import { OakJobsService } from './http/oak-jobs.service';
import { OakRecommendedResumeLookup } from './http/oak-recommended-resume.lookup';
import { OakRecommendedResumeService } from './http/oak-recommended-resume.service';
import { OakRuntimeFileService } from './http/oak-runtime-file.service';
import { OakAdminPrivilegesService } from './policy/oak-admin-privileges.service';
import { OakFillPolicyService } from './policy/oak-fill-policy.service';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    AiModule,
    AiUsageModule,
    JobsModule,
    ResumesModule,
  ],
  controllers: [OakAuthController, OakController],
  providers: [
    OakSessionService,
    OakAuthService,
    OakAuthGuard,
    OakProfilePromptService,
    OakResponsesService,
    OakAnalyzeService,
    OakProseService,
    OakIdentityService,
    OakMatchOptionService,
    OakJobsService,
    OakJobsMarkAppliedService,
    OakRecommendedResumeLookup,
    OakRecommendedResumeService,
    OakRuntimeFileService,
    OakAdminPrivilegesService,
    OakFillPolicyService,
    OakGatewayBootstrap,
  ],
  exports: [OakGatewayBootstrap, OakSessionService],
})
export class OakModule {}
