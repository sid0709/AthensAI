import { Injectable } from '@nestjs/common';
import type { ProfileLlmAuth } from '../../ai/auth/profile-llm-auth.service';
import { AI_ANALYZE_JD_MAX_CHARS } from '../../ai/constants/ai-concurrency.constants';
import { OpenAiChatService } from '../../ai/openai/openai-chat.service';
import type { ClaimedTempJob } from '../claim/claim-meta';
import { AiAnalyzeClaimService } from '../claim/ai-analyze-claim.service';
import { normalizeJobScrape } from '../mappers/job-metadata.mapper';
import { TempJobPromotionService } from '../temp-job-promotion.service';
import { asMetaRecord, mergeJobDetails } from './ai-analyze-merge';
import { parseAiAnalyzeJson } from './ai-analyze-parse';
import { JOB_AI_ANALYZE_PROMPT } from './ai-analyze.prompt';

export type AiAnalyzeBatchStats = {
  processed: number;
  extracted: number;
  failed: number;
  promoted: number;
};

@Injectable()
export class AiAnalyzeProcessService {
  constructor(
    private readonly chat: OpenAiChatService,
    private readonly claims: AiAnalyzeClaimService,
    private readonly promotion: TempJobPromotionService,
  ) {}

  async analyzeAndPersistBatch(input: {
    jobs: ClaimedTempJob[];
    auth: ProfileLlmAuth;
    sessionId: string;
    signal?: AbortSignal;
  }): Promise<AiAnalyzeBatchStats> {
    const stats: AiAnalyzeBatchStats = {
      processed: 0,
      extracted: 0,
      failed: 0,
      promoted: 0,
    };
    if (!input.jobs.length) return stats;

    const payload = input.jobs.map((job) => buildLlmJobInput(job));
    const ids = payload.map((p) => p.id);

    let content = '';
    try {
      const result = await this.chat.chatCompletion({
        apiKey: input.auth.apiKey,
        model: input.auth.model,
        provider: input.auth.provider,
        jsonMode: true,
        signal: input.signal,
        messages: [
          { role: 'system', content: JOB_AI_ANALYZE_PROMPT },
          { role: 'user', content: JSON.stringify({ jobs: payload }) },
        ],
      });
      content = result.content;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      for (const job of input.jobs) {
        await this.claims.persistFailure({
          id: job.id,
          sessionId: input.sessionId,
          code: 'LLM_ERROR',
          message,
        });
        stats.failed += 1;
        stats.processed += 1;
      }
      return stats;
    }

    const { valid, errors } = parseAiAnalyzeJson(content, ids);

    for (const job of input.jobs) {
      const parsed = valid.get(job.id);
      if (!parsed) {
        const err = errors.get(job.id);
        await this.claims.persistFailure({
          id: job.id,
          sessionId: input.sessionId,
          code: err?.code || 'MODEL_OUTPUT_INVALID',
          message: err?.message || 'AI analyze failed',
        });
        stats.failed += 1;
        stats.processed += 1;
        continue;
      }

      const meta = asMetaRecord(job.metadata);
      meta.details = mergeJobDetails(meta.details, parsed.details);
      const aa = asMetaRecord(meta.aiAnalyze);
      delete aa.lease;
      aa.processingState = 'completed';
      aa.analyzedAt = new Date().toISOString();
      meta.aiAnalyze = aa;

      const ok = await this.claims.persistSuccess({
        id: job.id,
        sessionId: input.sessionId,
        metadata: meta,
        aiSkills: parsed.skills,
      });
      if (!ok) {
        stats.failed += 1;
        stats.processed += 1;
        continue;
      }
      stats.extracted += 1;
      stats.processed += 1;

      try {
        const promoted = await this.promotion.promoteIfReady(job.id);
        if (promoted) stats.promoted += 1;
      } catch {
        /* leave in temp_jobs if promote validation fails */
      }
    }

    return stats;
  }
}

function buildLlmJobInput(job: ClaimedTempJob) {
  const meta = asMetaRecord(job.metadata);
  const scrape = normalizeJobScrape(meta.scrape);
  const description = String(job.description || '').slice(
    0,
    AI_ANALYZE_JD_MAX_CHARS,
  );
  return {
    id: job.id,
    title: job.title,
    companyName: job.companyName,
    description,
    existingDetails: meta.details ?? null,
    scrapeHints: scrape
      ? {
          tags: scrape.tags,
          skills: scrape.skills,
          companyTags: scrape.companyTags,
        }
      : null,
  };
}
