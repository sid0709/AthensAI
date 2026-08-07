import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AthensMetadataService } from './athens-metadata.service';
import { JobCatalogTotalService } from './job-catalog-total.service';
import { JobStatusCountsService } from './job-status-counts.service';
import { JobStatusService } from './job-status.service';
import { JobsController } from './jobs.controller';
import { JobsDetailService } from './jobs-detail.service';
import { JobsQueryService } from './jobs-query.service';
import { JobsService } from './jobs.service';
import { SkillExtractController } from './skill-extract.controller';
import { SkillExtractQueryService } from './skill-extract-query.service';
import { TitleReviewController } from './title-review.controller';
import { TitleReviewQueryService } from './title-review-query.service';

@Module({
  imports: [PrismaModule],
  controllers: [TitleReviewController, SkillExtractController, JobsController],
  providers: [
    JobsService,
    JobsQueryService,
    JobsDetailService,
    JobCatalogTotalService,
    JobStatusCountsService,
    JobStatusService,
    AthensMetadataService,
    TitleReviewQueryService,
    SkillExtractQueryService,
  ],
})
export class JobsModule {}
