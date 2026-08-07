import { Injectable } from '@nestjs/common';
import { AthensMetadataService } from './athens-metadata.service';

@Injectable()
export class SkillExtractQueryService {
  constructor(private readonly metadata: AthensMetadataService) {}

  /** Read-only status from temp_jobs queue — pending badge only; AI not wired yet. */
  async status() {
    const pending = await this.metadata.skillExtractPendingCount();
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
