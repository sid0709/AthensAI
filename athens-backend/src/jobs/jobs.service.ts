import { Injectable } from '@nestjs/common';
import type { ListJobsQueryDto } from './dto/list-jobs.query.dto';
import { JobsQueryService } from './jobs-query.service';

@Injectable()
export class JobsService {
  constructor(private readonly query: JobsQueryService) {}

  list(query: ListJobsQueryDto) {
    return this.query.list(query);
  }
}
