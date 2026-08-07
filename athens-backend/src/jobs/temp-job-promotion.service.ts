import { Injectable } from '@nestjs/common';
import { RegisterJobService } from './register-job.service';
import { isJobCatalogReady } from './constants/job-catalog-readiness.constants';

/**
 * Moves a ready TempJob into `jobs` via registerJob (delete from temp).
 * AI pipelines call this after both title review and AI analyze complete.
 */
@Injectable()
export class TempJobPromotionService {
  constructor(private readonly registerJobs: RegisterJobService) {}

  isReady(job: {
    titleReviewLabel: string;
    aiSkillStatus: string | null | undefined;
  }) {
    return isJobCatalogReady(job);
  }

  /** Move one temp row into jobs when ready. Returns false if missing or not ready. */
  async promoteIfReady(tempJobId: string): Promise<boolean> {
    return this.registerJobs.registerJob(tempJobId);
  }
}
