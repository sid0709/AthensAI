import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ProfileLlmAuthService } from '../../ai/auth/profile-llm-auth.service';
import { createLimiter } from '../../ai/concurrency/create-limiter';
import {
  RECOMMEND_RESUME_JSON_SCHEMA,
  RECOMMEND_RESUME_SCHEMA_NAME,
  RECOMMEND_RESUME_SYSTEM_PROMPT,
  parseRecommendResumeResponse,
} from '../../ai/prompts';
import { AiChatWithUsageService } from '../../ai-usage/ai-chat-with-usage.service';
import { AI_USAGE_FEATURES } from '../../ai-usage/constants/ai-usage.constants';
import {
  MAX_RECOMMEND_JOBS,
  RECOMMEND_CONCURRENCY,
} from '../../bids/constants/bid-status.constants';
import { resolveCatalogKey } from '../../bids/lib/resume-catalog';
import { PrismaService } from '../../prisma/prisma.service';
import { ResumeLibraryCatalogService } from '../../resumes/resume-library-catalog.service';
import { VendorTaskService } from '../../bids/vendor-task.service';
import {
  heuristicRecommend,
  normalizeRecommendJobIds,
} from './recommend-resumes.helpers';
import { RecommendPersistService } from './recommend-persist.service';

@Injectable()
export class RecommendResumesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llmAuth: ProfileLlmAuthService,
    private readonly chat: AiChatWithUsageService,
    private readonly persist: RecommendPersistService,
    private readonly libraryCatalog: ResumeLibraryCatalogService,
    private readonly vendorTasks: VendorTaskService,
  ) {}

  async recommendBulk(input: {
    applierName: string;
    jobIds: string[];
    replaceExisting?: boolean;
  }) {
    const name = String(input.applierName || '').trim();
    if (!name) {
      throw new BadRequestException({
        success: false,
        message: 'applierName is required',
      });
    }
    const account = await this.prisma.accountInfo.findUnique({
      where: { name },
      select: { id: true, name: true },
    });
    if (!account) {
      throw new NotFoundException({
        success: false,
        message: `User ${name} not found`,
      });
    }

    const jobIds = normalizeRecommendJobIds(input.jobIds, MAX_RECOMMEND_JOBS);
    if (!jobIds.length) {
      throw new BadRequestException({
        success: false,
        message: 'jobIds are required',
      });
    }

    const replaceExisting = input.replaceExisting !== false;
    const existingByJobId = new Map<
      string,
      Awaited<ReturnType<VendorTaskService['findByApplierJob']>>
    >();
    if (!replaceExisting) {
      await Promise.all(
        jobIds.map(async (jobId) => {
          existingByJobId.set(
            jobId,
            await this.vendorTasks.findByApplierJob(account.name, jobId),
          );
        }),
      );
    }
    const needsLlm = replaceExisting
      ? jobIds
      : jobIds.filter(
          (jobId) => !hasExistingRecommendation(existingByJobId.get(jobId) ?? null),
        );
    const catalog =
      needsLlm.length > 0
        ? await this.libraryCatalog.compressForProfile(account.id)
        : { text: '', stackNames: [] as string[] };
    const limiter = createLimiter(RECOMMEND_CONCURRENCY);
    const results = await Promise.all(
      jobIds.map((jobId) =>
        limiter.run(async () => {
          try {
            if (!replaceExisting) {
              const existing = existingByJobId.get(jobId) ?? null;
              if (hasExistingRecommendation(existing)) {
                return {
                  jobId,
                  ok: true as const,
                  skipped: true as const,
                  recommendedResumeStack:
                    existing?.recommendedResumeStack ?? null,
                  recommendedResumeReason:
                    existing?.recommendedResumeReason ?? null,
                  warning: existing?.recommendWarning ?? null,
                  mode: 'skipped' as const,
                  useCustomizedResume: Boolean(existing?.useCustomizedResume),
                };
              }
            }

            const outcome = await this.recommendOne(
              account.name,
              jobId,
              catalog,
            );
            await this.persist.persist({
              applierName: account.name,
              jobId,
              ...outcome.result,
              mode: outcome.mode,
              usage: outcome.usage,
              requestId: outcome.requestId,
            });
            return {
              jobId,
              ok: true as const,
              skipped: false as const,
              recommendedResumeStack:
                outcome.result.matchedCatalogKey ||
                outcome.result.recommendedResume,
              recommendedResumeReason: outcome.result.reason,
              warning: outcome.result.warning,
              mode: outcome.mode,
              useCustomizedResume: outcome.result.useCustomizedResume,
            };
          } catch (err) {
            return {
              jobId,
              ok: false as const,
              skipped: false as const,
              error: err instanceof Error ? err.message : String(err),
            };
          }
        }),
      ),
    );

    const succeeded = results.filter((r) => r.ok && !r.skipped).length;
    const skipped = results.filter((r) => r.ok && r.skipped).length;
    const failed = results.filter((r) => !r.ok).length;
    return {
      success: true as const,
      applierName: account.name,
      total: jobIds.length,
      succeeded,
      skipped,
      failed,
      replaceExisting,
      results,
    };
  }

  private async recommendOne(
    applierName: string,
    jobId: string,
    catalog: { text: string; stackNames: string[] },
  ) {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      select: { id: true, description: true, title: true },
    });
    if (!job) throw new Error('Job not found');

    const pageText = String(job.description || '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!pageText) {
      return heuristicRecommend({
        useCustomizedResume: true,
        warning:
          'Page text is empty — open the job description page and try again.',
        reason: 'No page text.',
      });
    }

    if (!catalog.stackNames.length) {
      return heuristicRecommend({
        useCustomizedResume: true,
        warning:
          'No analyzed Library resumes. Analyze resumes in My Resume\'s Library first.',
        reason: 'Empty library catalog — use customized resume.',
      });
    }

    let auth: Awaited<ReturnType<ProfileLlmAuthService['resolve']>>;
    try {
      auth = await this.llmAuth.resolve({ applierName });
    } catch {
      return heuristicRecommend({
        useCustomizedResume: true,
        warning:
          'LLM unavailable — set an API key on the applier autoBidProfile.',
        reason: 'No LLM API key.',
      });
    }

    const allowedList = catalog.stackNames.map((s) => `- ${s}`).join('\n');
    const requestId = randomUUID();
    const completion = await this.chat.chatCompletion({
      provider: auth.provider,
      apiKey: auth.apiKey,
      model: auth.model,
      jsonMode: true,
      jsonSchema: {
        name: RECOMMEND_RESUME_SCHEMA_NAME,
        schema: RECOMMEND_RESUME_JSON_SCHEMA as unknown as Record<
          string,
          unknown
        >,
        strict: true,
      },
      messages: [
        { role: 'system', content: RECOMMEND_RESUME_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `ALLOWED RESUME LABELS (pick exactly one or null):\n${allowedList}\n\nRESUME CATALOG:\n${catalog.text}\n\n=== PAGE TEXT ===\nURL: (job)\nTitle: ${job.title || '(unknown)'}\n\n${pageText}`,
        },
      ],
      usageMeta: {
        feature: AI_USAGE_FEATURES.recommendResume,
        applierName: auth.applierName,
        jobId: String(job.id || ''),
        requestId,
        path: '/jobs/recommend-resumes',
      },
    });

    const parsed = parseRecommendResumeResponse(completion.content);
    const usage = completion.usage
      ? { ...completion.usage, model: auth.model }
      : null;

    if (!parsed.isJobDescription) {
      return {
        result: {
          recommendedResume: null,
          matchedCatalogKey: null,
          useCustomizedResume: false,
          warning:
            'This page does not appear to contain a job description. Open the JD page and try again.',
          reason: parsed.reason || 'Not a job description.',
        },
        mode: 'llm' as const,
        usage,
        requestId,
      };
    }

    const matchedCatalogKey = resolveCatalogKey(
      parsed.recommendedResume,
      catalog.stackNames,
    );
    const useCustomizedResume = !matchedCatalogKey;
    return {
      result: {
        recommendedResume: matchedCatalogKey,
        matchedCatalogKey,
        useCustomizedResume,
        warning: useCustomizedResume
          ? 'No Library stack matched — use customized resume.'
          : null,
        reason:
          parsed.reason ||
          (matchedCatalogKey
            ? `Matched ${matchedCatalogKey}.`
            : 'No match.'),
      },
      mode: 'llm' as const,
      usage,
      requestId,
    };
  }
}

function hasExistingRecommendation(
  task: Awaited<ReturnType<VendorTaskService['findByApplierJob']>>,
): boolean {
  if (!task) return false;
  if (task.recommendedAt) return true;
  if (String(task.recommendedResumeStack || '').trim()) return true;
  if (task.useCustomizedResume) return true;
  return false;
}
