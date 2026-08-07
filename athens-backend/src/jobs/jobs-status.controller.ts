import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { GetJobQueryDto } from './dto/get-job.query.dto';
import {
  BulkBidStatusDto,
  JobStatusApplierDto,
  UpdateJobBidStatusDto,
  UpdateJobPipelineStatusDto,
} from './dto/job-status-mutate.dto';
import { JobStatusMutateService } from './job-status-mutate.service';

@Controller('jobs')
export class JobsStatusController {
  constructor(private readonly mutate: JobStatusMutateService) {}

  @Post('bid-status/bulk')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  bulkBid(@Body() body: BulkBidStatusDto) {
    return this.mutate.setBidStatusBulk(
      body.applierName,
      body.status,
      body.jobs,
      body.mutationId,
    );
  }

  @Get(':id/viewer-status')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  viewerStatus(@Param('id') id: string, @Query() query: GetJobQueryDto) {
    return this.mutate.viewerStatus(id, query.applierName || '');
  }

  @Post(':id/apply')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  apply(@Param('id') id: string, @Body() body: JobStatusApplierDto) {
    return this.mutate.apply(id, body.applierName, body.mutationId);
  }

  @Post(':id/status')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  status(@Param('id') id: string, @Body() body: UpdateJobPipelineStatusDto) {
    return this.mutate.setPipelineStatus(
      id,
      body.applierName,
      body.status,
      body.mutationId,
    );
  }

  @Post(':id/unapply')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  unapply(@Param('id') id: string, @Body() body: JobStatusApplierDto) {
    return this.mutate.unapply(id, body.applierName, body.mutationId);
  }

  @Post(':id/bid-status')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  bidStatus(@Param('id') id: string, @Body() body: UpdateJobBidStatusDto) {
    return this.mutate.setBidStatus(
      id,
      body.applierName,
      body.status,
      body.mutationId,
    );
  }
}
