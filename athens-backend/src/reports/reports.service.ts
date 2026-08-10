import { Injectable } from '@nestjs/common';
import { ReportsApplicationsService } from './reports-applications.service';
import { ReportsPostingsService } from './reports-postings.service';
import { okReportData } from './mappers/reports-response.mapper';

@Injectable()
export class ReportsService {
  constructor(
    private readonly postings: ReportsPostingsService,
    private readonly applications: ReportsApplicationsService,
  ) {}

  async jobSourceSummary(
    applierName?: string,
    startDate?: string,
    endDate?: string,
  ) {
    const [postingsBySource, statusBySource] = await Promise.all([
      this.postings.postingsBySource(startDate, endDate),
      this.applications.statusCountsBySource(applierName, startDate, endDate),
    ]);
    const data = this.postings.mergeSourceSummary(
      postingsBySource,
      statusBySource.applied,
      statusBySource.scheduled,
      statusBySource.declined,
    );
    return okReportData(data);
  }

  async dailyApplications(
    applierName?: string,
    startDate?: string,
    endDate?: string,
  ) {
    const data = await this.applications.dailyApplications(
      applierName,
      startDate,
      endDate,
    );
    return okReportData(data);
  }

  async dailyPostingsBySource(startDate?: string, endDate?: string) {
    const data = await this.postings.dailyBySource(startDate, endDate);
    return okReportData(data);
  }
}
