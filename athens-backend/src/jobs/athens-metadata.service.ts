import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  ATHENS_METADATA_QUEUES,
  SKILL_EXTRACT_META_STATES,
  TITLE_REVIEW_META_STATES,
  type AthensMetadataQueue,
  type SkillExtractMetaState,
  type TitleReviewMetaState,
} from './constants/athens-metadata.constants';

@Injectable()
export class AthensMetadataService {
  constructor(private readonly prisma: PrismaService) {}

  countByQueueState(queue: AthensMetadataQueue, state: string) {
    return this.prisma.athensMetadata.count({ where: { queue, state } });
  }

  async titleReviewCounts() {
    const [pending, reviewRequired, failed] = await Promise.all([
      this.countByQueueState(
        ATHENS_METADATA_QUEUES.TITLE_REVIEW,
        TITLE_REVIEW_META_STATES.PENDING,
      ),
      this.countByQueueState(
        ATHENS_METADATA_QUEUES.TITLE_REVIEW,
        TITLE_REVIEW_META_STATES.REVIEW_REQUIRED,
      ),
      this.countByQueueState(
        ATHENS_METADATA_QUEUES.TITLE_REVIEW,
        TITLE_REVIEW_META_STATES.FAILED,
      ),
    ]);
    return {
      pending,
      unreviewedCount: pending,
      reviewRequiredCount: reviewRequired,
      failedCount: failed,
    };
  }

  /** APPROVED titles still pending/failed skill extraction (shared global queue). */
  async skillExtractPendingCount() {
    const [pending, failed] = await Promise.all([
      this.countByQueueState(
        ATHENS_METADATA_QUEUES.SKILL_EXTRACT,
        SKILL_EXTRACT_META_STATES.PENDING,
      ),
      this.countByQueueState(
        ATHENS_METADATA_QUEUES.SKILL_EXTRACT,
        SKILL_EXTRACT_META_STATES.FAILED,
      ),
    ]);
    return pending + failed;
  }

  listJobIds(
    queue: AthensMetadataQueue,
    state: TitleReviewMetaState | SkillExtractMetaState,
  ) {
    return this.prisma.athensMetadata.findMany({
      where: { queue, state },
      select: { jobId: true },
    });
  }
}
