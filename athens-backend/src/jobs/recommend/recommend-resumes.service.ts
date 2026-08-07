import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ProfileLlmAuthService } from '../../ai/auth/profile-llm-auth.service';
import { OpenAiChatService } from '../../ai/openai/openai-chat.service';
import {
  MAX_RECOMMEND_JOBS,
  RECOMMEND_CONCURRENCY,
} from '../../bids/constants/bid-status.constants';
import {
  compressResumeCatalog,
  resolveCatalogKey,
} from '../../bids/lib/resume-catalog';
import { PrismaService } from '../../prisma/prisma.service';
import { createLimiter } from '../../ai/concurrency/create-limiter';
import { RecommendPersistService } from './recommend-persist.service';
import { RECOMMEND_RESUME_SYSTEM_PROMPT } from './recommend.prompt';

const OBJECT_ID_RE = /^[a-f\d]{24}$/i;

@Injectable()
export class RecommendResumesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llmAuth: ProfileLlmAuthService,
    private readonly chat: OpenAiChatService,
    private readonly persist: RecommendPersistService,
  ) {}

  async recommendBulk(input: { applierName: string; jobIds: string[] }) {
    const name = String(input.applierName || '').trim();
    if (!name) {
      throw new BadRequestException({
        success: false,
        message: 'applierName is required',
      });
    }
    const account = await this.prisma.accountInfo.findUnique({
      where: { name },
      select: {
        id: true,
        name: true,
        resumeAnalysisCatalog: true,
        autoBidProfile: true,
      },
    });
    if (!account) {
      throw new NotFoundException({
        success: false,
        message: `User ${name} not found`,
      });
    }

    const jobIds = normalizeJobIds(input.jobIds);
    if (!jobIds.length) {
      throw new BadRequestException({
        success: false,
        message: 'jobIds are required',
      });
    }

    const limiter = createLimiter(RECOMMEND_CONCURRENCY);
    const results = await Promise.all(
      jobIds.map((jobId) =>
        limiter.run(async () => {
          try {
            const outcome = await this.recommendOne(account, jobId);
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
              error: err instanceof Error ? err.message : String(err),
            };
          }
        }),
      ),
    );

    const succeeded = results.filter((r) => r.ok).length;
    return {
      success: true as const,
      applierName: account.name,
      total: jobIds.length,
      succeeded,
      failed: jobIds.length - succeeded,
      results,
    };
  }

  private async recommendOne(
    account: {
      id: string;
      name: string;
      resumeAnalysisCatalog: unknown;
      autoBidProfile: unknown;
    },
    jobId: string,
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
      return heuristic({
        useCustomizedResume: true,
        warning:
          'Page text is empty — open the job description page and try again.',
        reason: 'No page text.',
        stackCount: 0,
        isJobDescription: false,
      });
    }

    const catalog =
      account.resumeAnalysisCatalog &&
      typeof account.resumeAnalysisCatalog === 'object'
        ? account.resumeAnalysisCatalog
        : {};
    const { text: catalogText, stackNames } = compressResumeCatalog(catalog);

    if (!stackNames.length) {
      return heuristic({
        useCustomizedResume: true,
        warning: 'No analyzed Library resumes in resumeAnalysisCatalog.',
        reason: 'Empty catalog — use customized resume.',
        stackCount: 0,
        isJobDescription: true,
      });
    }

    let auth: Awaited<ReturnType<ProfileLlmAuthService['resolve']>>;
    try {
      auth = await this.llmAuth.resolve({ applierName: account.name });
    } catch {
      return heuristic({
        useCustomizedResume: true,
        warning:
          'LLM unavailable — set an API key on the applier autoBidProfile.',
        reason: 'No LLM API key.',
        stackCount: stackNames.length,
        isJobDescription: false,
      });
    }

    const allowedList = stackNames.map((s) => `- ${s}`).join('\n');
    const requestId = randomUUID();
    const completion = await this.chat.chatCompletion({
      provider: auth.provider,
      apiKey: auth.apiKey,
      model: auth.model,
      jsonMode: true,
      messages: [
        { role: 'system', content: RECOMMEND_RESUME_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `ALLOWED RESUME LABELS (pick exactly one or null):\n${allowedList}\n\nRESUME CATALOG:\n${catalogText}\n\n=== PAGE TEXT ===\nURL: (job)\nTitle: ${job.title || '(unknown)'}\n\n${pageText}`,
        },
      ],
    });

    let parsed: {
      isJobDescription?: boolean;
      recommendedResume?: string | null;
      reason?: string;
    };
    try {
      parsed = JSON.parse(completion.content) as typeof parsed;
    } catch {
      throw new Error('LLM returned invalid JSON for resume recommendation.');
    }

    const isJobDescription = Boolean(parsed.isJobDescription);
    const reason = String(parsed.reason ?? '').trim() || null;
    const usage = completion.usage
      ? { ...completion.usage, model: auth.model }
      : null;

    if (!isJobDescription) {
      return {
        result: {
          recommendedResume: null,
          matchedCatalogKey: null,
          useCustomizedResume: false,
          warning:
            'This page does not appear to contain a job description. Open the JD page and try again.',
          reason: reason || 'Not a job description.',
        },
        mode: 'llm' as const,
        usage,
        requestId,
      };
    }

    const matchedCatalogKey = resolveCatalogKey(
      parsed.recommendedResume,
      stackNames,
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
          reason ||
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

function heuristic(input: {
  useCustomizedResume: boolean;
  warning: string;
  reason: string;
  stackCount: number;
  isJobDescription: boolean;
}) {
  return {
    result: {
      recommendedResume: null as string | null,
      matchedCatalogKey: null as string | null,
      useCustomizedResume: input.useCustomizedResume,
      warning: input.warning,
      reason: input.reason,
    },
    mode: 'heuristic' as const,
    usage: null as Record<string, unknown> | null,
    requestId: null as string | null,
  };
}

function normalizeJobIds(raw: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of Array.isArray(raw) ? raw : []) {
    const jobId = String(id || '').trim();
    if (!OBJECT_ID_RE.test(jobId) || seen.has(jobId)) continue;
    seen.add(jobId);
    out.push(jobId);
    if (out.length >= MAX_RECOMMEND_JOBS) break;
  }
  return out;
}
