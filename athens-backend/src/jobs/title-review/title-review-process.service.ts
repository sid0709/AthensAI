import { Injectable } from '@nestjs/common';
import type { ProfileLlmAuth } from '../../ai/auth/profile-llm-auth.service';
import { OpenAiChatService } from '../../ai/openai/openai-chat.service';
import type { ClaimedTempJob } from '../claim/claim-meta';
import { TitleReviewClaimService } from '../claim/title-review-claim.service';
import { JOB_TITLE_REVIEW_LABELS } from '../constants/job-pipeline.constants';
import { parseTitleReviewJson } from './title-review-parse';
import { JOB_TITLE_REVIEW_PROMPT } from './title-review.prompt';

export type TitleReviewBatchStats = {
  processed: number;
  approved: number;
  reviewRequired: number;
  failed: number;
};

@Injectable()
export class TitleReviewProcessService {
  constructor(
    private readonly chat: OpenAiChatService,
    private readonly claims: TitleReviewClaimService,
  ) {}

  async classifyAndPersistBatch(input: {
    jobs: ClaimedTempJob[];
    auth: ProfileLlmAuth;
    sessionId: string;
    signal?: AbortSignal;
  }): Promise<TitleReviewBatchStats> {
    const items = input.jobs.map((job, index) => ({
      index,
      id: job.id,
      title: String(job.title || ''),
    }));
    const stats: TitleReviewBatchStats = {
      processed: 0,
      approved: 0,
      reviewRequired: 0,
      failed: 0,
    };
    if (!items.length) return stats;

    let content = '';
    try {
      const result = await this.chat.chatCompletion({
        apiKey: input.auth.apiKey,
        model: input.auth.model,
        provider: input.auth.provider,
        jsonMode: true,
        signal: input.signal,
        messages: [
          { role: 'system', content: JOB_TITLE_REVIEW_PROMPT },
          {
            role: 'user',
            content: JSON.stringify(
              items.map(({ index, title }) => ({ index, title })),
            ),
          },
        ],
      });
      content = result.content;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      for (const item of items) {
        await this.claims.persistFailure({
          id: item.id,
          sessionId: input.sessionId,
          code: 'LLM_ERROR',
          message,
        });
        stats.failed += 1;
        stats.processed += 1;
      }
      return stats;
    }

    const { valid, errors } = parseTitleReviewJson(content, items);

    for (const item of items) {
      const row = valid.get(item.index);
      if (row) {
        const ok = await this.claims.persistSuccess({
          id: item.id,
          sessionId: input.sessionId,
          title: row.title,
          label: row.label,
          confidence: row.confidence,
          reason: row.reason,
        });
        if (!ok) {
          stats.failed += 1;
        } else if (row.label === JOB_TITLE_REVIEW_LABELS.APPROVED) {
          stats.approved += 1;
        } else {
          stats.reviewRequired += 1;
        }
        stats.processed += 1;
        continue;
      }
      const err = errors.get(item.index);
      await this.claims.persistFailure({
        id: item.id,
        sessionId: input.sessionId,
        code: err?.code || 'MODEL_OUTPUT_INVALID',
        message: err?.message || 'Title review failed',
      });
      stats.failed += 1;
      stats.processed += 1;
    }

    return stats;
  }
}
