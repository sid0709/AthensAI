import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { BidReviewEventsService } from '../../bids/bid-review-events.service';
import { matchUploadToRecommended } from '../../bids/lib/resume-catalog';
import { VendorTaskService } from '../../bids/vendor-task.service';

@Injectable()
export class RecommendPersistService {
  constructor(
    private readonly vendorTasks: VendorTaskService,
    private readonly events: BidReviewEventsService,
  ) {}

  async persist(input: {
    applierName: string;
    jobId: string;
    recommendedResume: string | null;
    matchedCatalogKey: string | null;
    reason: string | null;
    useCustomizedResume: boolean;
    warning: string | null;
    mode: 'llm' | 'heuristic';
    usage?: Record<string, unknown> | null;
    requestId?: string | null;
  }) {
    const existing = await this.vendorTasks.findByApplierJob(
      input.applierName,
      input.jobId,
    );
    const stack = input.matchedCatalogKey || input.recommendedResume || null;
    const resumeStackMatch = matchUploadToRecommended(
      existing?.resumeOriginalName,
      stack,
    );

    const doc = await this.vendorTasks.upsertFields(
      input.applierName,
      input.jobId,
      {
        recommendedResumeStack: stack,
        recommendedResumeId: null,
        recommendedResumeReason: input.reason,
        useCustomizedResume: input.useCustomizedResume,
        recommendWarning: input.warning,
        recommendedAt: new Date(),
        recommendMode: input.mode,
        recommendUsage: (input.usage ?? undefined) as
          Prisma.InputJsonValue | undefined,
        recommendRequestId: input.requestId ?? null,
        resumeStackMatch,
      },
    );

    await this.events.append({
      applierName: input.applierName,
      jobId: input.jobId,
      vendorTaskId: doc.id,
      eventType: 'recommend_resume',
      eventKey: input.requestId ? `ai:${input.requestId}` : undefined,
      feature: 'bid-recommend-resume',
      meta: {
        recommendedResumeStack: stack,
        useCustomizedResume: input.useCustomizedResume,
        mode: input.mode,
      },
    });

    return doc;
  }
}
