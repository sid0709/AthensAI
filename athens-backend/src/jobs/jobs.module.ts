import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { JobStatusCountsService } from './job-status-counts.service';
import { JobStatusService } from './job-status.service';
import { JobsController } from './jobs.controller';
import { JobsQueryService } from './jobs-query.service';
import { JobsService } from './jobs.service';

@Module({
  imports: [PrismaModule],
  controllers: [JobsController],
  providers: [
    JobsService,
    JobsQueryService,
    JobStatusCountsService,
    JobStatusService,
  ],
})
export class JobsModule {}
