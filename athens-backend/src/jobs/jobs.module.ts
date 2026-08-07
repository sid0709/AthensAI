import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CompanyCatalogTotalService } from './company-catalog-total.service';
import { CompanyMembershipService } from './company-membership.service';
import { ExposeJobsController } from './expose-jobs.controller';
import { JobCatalogTotalService } from './job-catalog-total.service';
import { JobStatusCountsService } from './job-status-counts.service';
import { JobStatusService } from './job-status.service';
import { JobsBulkController } from './jobs-bulk.controller';
import { JobsCompanyListService } from './jobs-company-list.service';
import { JobsController } from './jobs.controller';
import { JobsDetailService } from './jobs-detail.service';
import { JobsQueryService } from './jobs-query.service';
import { JobsService } from './jobs.service';
import { RegisterJobService } from './register-job.service';
import { SaveJobService } from './save-job.service';
import { SkillExtractController } from './skill-extract.controller';
import { SkillExtractQueryService } from './skill-extract-query.service';
import { TempJobPromotionService } from './temp-job-promotion.service';
import { TempJobQueueService } from './temp-job-queue.service';
import { TitleReviewController } from './title-review.controller';
import { TitleReviewQueryService } from './title-review-query.service';

@Module({
  imports: [PrismaModule],
  controllers: [
    TitleReviewController,
    SkillExtractController,
    ExposeJobsController,
    JobsBulkController,
    JobsController,
  ],
  providers: [
    JobsService,
    JobsQueryService,
    JobsCompanyListService,
    JobsDetailService,
    JobCatalogTotalService,
    CompanyCatalogTotalService,
    CompanyMembershipService,
    JobStatusCountsService,
    JobStatusService,
    TempJobQueueService,
    TitleReviewQueryService,
    SkillExtractQueryService,
    SaveJobService,
    RegisterJobService,
    TempJobPromotionService,
  ],
})
export class JobsModule {}
