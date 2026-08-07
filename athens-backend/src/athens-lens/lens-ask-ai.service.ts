import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import { ProfileLlmAuthService } from '../ai/auth/profile-llm-auth.service';
import { OpenAiChatService } from '../ai/openai/openai-chat.service';
import { BidLifecycleService } from '../bids/bid-lifecycle.service';
import { ProfileSecretsService } from '../personal/secrets/profile-secrets.service';
import { PrismaService } from '../prisma/prisma.service';
import { ASK_AI_SYSTEM_PROMPT } from './ask-ai.prompt';

const TEXT_MAX = 12_000;

@Injectable()
export class LensAskAiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llmAuth: ProfileLlmAuthService,
    private readonly chat: OpenAiChatService,
    private readonly secrets: ProfileSecretsService,
    private readonly lifecycle: BidLifecycleService,
  ) {}

  async answer(input: {
    applierName: string;
    pageContext: Record<string, unknown>;
    jobId?: string;
    jobTitle?: string;
    stream?: boolean;
  }) {
    const visibleText = String(input.pageContext.visibleText || '')
      .slice(0, TEXT_MAX)
      .trim();
    const formTree = String(input.pageContext.formTree || '')
      .slice(0, TEXT_MAX)
      .trim();
    if (!visibleText && !formTree) {
      throw new BadRequestException({
        success: false,
        message: 'pageContext.visibleText or formTree is required',
      });
    }

    const account = await this.prisma.accountInfo.findUnique({
      where: { name: input.applierName },
      select: { autoBidProfile: true, name: true },
    });
    const profileRaw =
      account?.autoBidProfile && typeof account.autoBidProfile === 'object'
        ? (account.autoBidProfile as Record<string, unknown>)
        : {};
    const decrypted = this.secrets.decryptSelected(profileRaw, []);
    const profileJson = JSON.stringify(
      sanitizeProfile(decrypted),
      null,
      2,
    ).slice(0, 4000);

    let auth: Awaited<ReturnType<ProfileLlmAuthService['resolve']>>;
    try {
      auth = await this.llmAuth.resolve({ applierName: input.applierName });
    } catch {
      return {
        success: true as const,
        mode: 'heuristic' as const,
        summary: 'LLM unavailable — set an API key in Settings.',
        answers: [] as Array<{
          question: string;
          suggestedAnswer: string;
          confidence: string;
        }>,
        pageUrl: String(input.pageContext.url || ''),
        pageTitle: String(input.pageContext.title || ''),
      };
    }

    const userPrompt = `APPLICANT PROFILE (JSON):
${profileJson}

=== CURRENT PAGE ===
URL: ${input.pageContext.url || ''}
Title: ${input.pageContext.title || ''}
Meta: ${input.pageContext.metaDescription || '(none)'}
${input.jobTitle ? `Role: ${input.jobTitle}\n` : ''}
Page text:
${visibleText || '(none)'}

Form tree:
${formTree || '(none)'}`;

    const requestId = randomUUID();
    const completion = await this.chat.chatCompletion({
      provider: auth.provider,
      apiKey: auth.apiKey,
      model: auth.model,
      jsonMode: true,
      messages: [
        { role: 'system', content: ASK_AI_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
    });

    let parsed: {
      isJobPage?: boolean;
      summary?: string;
      formAnswers?: Array<{
        question?: string;
        suggestedAnswer?: string;
        confidence?: string;
      }>;
    };
    try {
      parsed = JSON.parse(completion.content) as typeof parsed;
    } catch {
      throw new BadRequestException({
        success: false,
        message: 'LLM returned invalid JSON',
      });
    }

    const answers = (parsed.formAnswers || [])
      .map((a) => ({
        question: String(a.question || '').trim(),
        suggestedAnswer: String(a.suggestedAnswer || '').trim(),
        confidence: ['high', 'medium', 'low'].includes(String(a.confidence))
          ? String(a.confidence)
          : 'medium',
      }))
      .filter((a) => a.question && a.suggestedAnswer);

    const summary = String(parsed.summary || '').trim();
    const pageUrl = String(input.pageContext.url || '');
    const pageTitle = String(input.pageContext.title || '');

    if (input.jobId) {
      await this.lifecycle.persistAnalysis({
        applierName: input.applierName,
        jobId: input.jobId,
        summary,
        answers,
        pageUrl,
        pageTitle,
        mode: 'llm',
        usage: completion.usage
          ? { ...completion.usage, model: auth.model }
          : undefined,
        requestId,
      });
    }

    return {
      success: true as const,
      mode: 'llm' as const,
      summary,
      answers,
      pageUrl,
      pageTitle,
      usage: completion.usage,
      requestId,
    };
  }
}

function sanitizeProfile(profile: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const omitRe =
    /(apikey|api_key|apppassword|app_password|password|secret|token|privatekey|private_key)/i;
  for (const [key, value] of Object.entries(profile)) {
    if (omitRe.test(key)) continue;
    if (value === undefined || value === null || value === '') continue;
    out[key] = value;
  }
  return out;
}
