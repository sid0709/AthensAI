import {
  Controller,
  Get,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ReportsRangeQueryDto } from './dto/reports-range.query.dto';
import { ReportsService } from './reports.service';

@Controller('reports')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('job-source-summary')
  jobSourceSummary(@Query() query: ReportsRangeQueryDto) {
    return this.reports.jobSourceSummary(
      query.applierName,
      query.startDate,
      query.endDate,
    );
  }

  @Get('daily-applications')
  dailyApplications(@Query() query: ReportsRangeQueryDto) {
    return this.reports.dailyApplications(
      query.applierName,
      query.startDate,
      query.endDate,
    );
  }

  @Get('daily-postings-by-source')
  dailyPostingsBySource(@Query() query: ReportsRangeQueryDto) {
    return this.reports.dailyPostingsBySource(query.startDate, query.endDate);
  }
}
