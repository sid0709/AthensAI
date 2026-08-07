import {
  Controller,
  Get,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ListJobsQueryDto } from './dto/list-jobs.query.dto';
import { JobsService } from './jobs.service';

@Controller('jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  /** Read-only Job Search catalog. Filters + pagination via query string. */
  @Get()
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  list(@Query() query: ListJobsQueryDto) {
    return this.jobs.list(query);
  }
}
