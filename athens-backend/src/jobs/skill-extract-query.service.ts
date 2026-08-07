import { Injectable } from '@nestjs/common';
import { TempJobQueueService } from './temp-job-queue.service';

@Injectable()
export class SkillExtractQueryService {
  constructor(private readonly queues: TempJobQueueService) {}

  /** Read-only badge from `temp_jobs` — AI extraction not wired yet. */
  async status() {
    const pending = await this.queues.skillExtractPendingCount();
    return {
      success: true as const,
      running: false,
      status: 'idle' as const,
      pending,
      pendingKnown: true,
      total: pending,
      processed: 0,
      extracted: 0,
      failed: 0,
      remaining: pending,
    };
  }
}
