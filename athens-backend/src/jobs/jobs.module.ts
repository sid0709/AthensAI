import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { BidsModule } from '../bids/bids.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AiAnalyzeController } from './ai-analyze/ai-analyze.controller';
import { AiAnalyzeProcessService } from './ai-analyze/ai-analyze-process.service';
import { AiAnalyzeSessionService } from './ai-analyze/ai-analyze-session.service';
import { AiAnalyzeClaimService } from './claim/ai-analyze-claim.service';
import { TitleReviewClaimService } from './claim/title-review-claim.service';
import { CompanyCatalogTotalService } from './company-catalog-total.service';
import { CompanyMembershipService } from './company-membership.service';
import { ExposeJobsController } from './expose-jobs.controller';
import { JobCatalogTotalService } from './job-catalog-total.service';
import { JobDedupeService } from './job-dedupe.service';
import { JobHardDeleteService } from './job-hard-delete.service';
import { JobStatusMutateService } from './job-status-mutate.service';
import { JobStatusService } from './job-status.service';
import { JobsBulkController } from './jobs-bulk.controller';
import { JobsCompanyListService } from './jobs-company-list.service';
import { JobsController } from './jobs.controller';
import { JobsDetailService } from './jobs-detail.service';
import { JobsQueryService } from './jobs-query.service';
import { JobsRemoveController } from './jobs-remove.controller';
import { JobsStatusController } from './jobs-status.controller';
import { JobsService } from './jobs.service';
import { RecommendPersistService } from './recommend/recommend-persist.service';
import { RecommendResumesController } from './recommend/recommend-resumes.controller';
import { RecommendResumesService } from './recommend/recommend-resumes.service';
import { RegisterJobService } from './register-job.service';
import { SaveJobService } from './save-job.service';
import { SkillExtractController } from './skill-extract.controller';
import { TempJobPromotionService } from './temp-job-promotion.service';
import { TempJobQueueService } from './temp-job-queue.service';
import { TitleReviewController } from './title-review.controller';
import { TitleReviewQueryService } from './title-review-query.service';
import { TitleReviewProcessService } from './title-review/title-review-process.service';
import { TitleReviewSessionService } from './title-review/title-review-session.service';

@Module({
  imports: [PrismaModule, AiModule, BidsModule],
  controllers: [
    TitleReviewController,
    AiAnalyzeController,
    SkillExtractController,
    ExposeJobsController,
    JobsBulkController,
    JobsRemoveController,
    JobsStatusController,
    JobsController,
    RecommendResumesController,
  ],
  providers: [
    JobsService,
    JobsQueryService,
    JobsCompanyListService,
    JobsDetailService,
    JobCatalogTotalService,
    CompanyCatalogTotalService,
    CompanyMembershipService,
    JobStatusService,
    JobStatusMutateService,
    JobHardDeleteService,
    JobDedupeService,
    TempJobQueueService,
    TitleReviewClaimService,
    AiAnalyzeClaimService,
    TitleReviewQueryService,
    TitleReviewProcessService,
    TitleReviewSessionService,
    AiAnalyzeProcessService,
    AiAnalyzeSessionService,
    SaveJobService,
    RegisterJobService,
    TempJobPromotionService,
    RecommendResumesService,
    RecommendPersistService,
  ],
})
export class JobsModule {}
