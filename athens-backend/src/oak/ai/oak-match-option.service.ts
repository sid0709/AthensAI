import { Injectable } from '@nestjs/common';
import { ProfileLlmAuthService } from '../../ai/auth/profile-llm-auth.service';
import { OpenAiChatService } from '../../ai/openai/openai-chat.service';
import { AI_USAGE_FEATURES } from '../../ai-usage/constants/ai-usage.constants';
import { AiUsageRecorderService } from '../../ai-usage/ai-usage-recorder.service';
import { oakMatchOptionMaxOutputTokens } from '../constants/oak.constants';
import { MATCH_OPTION_SYSTEM_PROMPT } from './oak-prompt';
import { summarizeUsage } from './oak-pricing';
import { OakResponsesService } from './oak-responses.service';
import { MATCH_OPTION_FORMAT } from './oak-schema';

@Injectable()
export class OakMatchOptionService {
  constructor(
    private readonly llmAuth: ProfileLlmAuthService,
    private readonly responses: OakResponsesService,
    private readonly chat: OpenAiChatService,
    private readonly usage: AiUsageRecorderService,
  ) {}

  async match(input: {
    profileId: string;
    applierName: string;
    intendedValue: string;
    options: string[];
    fieldLabel?: string | null;
    typedQuery?: string | null;
  }) {
    const list = input.options.filter((o) => typeof o === 'string' && o.trim());
    const auth = await this.llmAuth.resolve({
      profileId: input.profileId,
      applierName: input.applierName,
    });

    if (!input.intendedValue || !list.length) {
      return {
        ok: true as const,
        matched_option: null,
        confidence: 0,
        reason: 'Missing value or options',
        model: auth.model,
      };
    }

    const userPrompt = [
      input.fieldLabel ? `Field label: ${input.fieldLabel}` : null,
      input.typedQuery ? `Current typed filter: ${input.typedQuery}` : null,
      `Intended answer: ${input.intendedValue}`,
      'Visible options:',
      ...list.map((opt, i) => `${i + 1}. ${opt}`),
      'Pick the best matching option string exactly, or null.',
      'Respond with json.',
    ]
      .filter(Boolean)
      .join('\n');

    const startedAt = new Date();
    const t0 = Date.now();
    // #region agent log
    try {
      const { appendFile } = await import('fs/promises');
      await appendFile(
        '/Users/robin/Desktop/Utils/AthensAI/.cursor/debug-543c46.log',
        `${JSON.stringify({
          sessionId: '543c46',
          runId: 'post-fix',
          hypothesisId: 'G',
          location: 'oak-match-option.service.ts:entry',
          message: 'match-option request',
          data: {
            optionCount: list.length,
            intendedLen: input.intendedValue.trim().length,
            fieldLabelLen: String(input.fieldLabel || '').trim().length,
            jsonMode: false,
            promptHasJson: /json/i.test(`${MATCH_OPTION_SYSTEM_PROMPT}\n${userPrompt}`),
            provider: auth.provider,
          },
          timestamp: Date.now(),
        })}\n`,
      );
    } catch {
      /* ignore */
    }
    // #endregion
    try {
      const raw =
        auth.provider === 'openai'
          ? await this.responses.requestJsonSchema(
              { apiKey: auth.apiKey, model: auth.model },
              {
                systemPrompt: MATCH_OPTION_SYSTEM_PROMPT,
                userPrompt,
                format: MATCH_OPTION_FORMAT,
                maxOutputTokens: oakMatchOptionMaxOutputTokens(),
                clampReasoningToLow: true,
              },
            )
          : await this.matchViaChat(auth, userPrompt);

      let parsed: {
        matched_option?: unknown;
        confidence?: unknown;
        reason?: unknown;
      };
      try {
        parsed = JSON.parse(raw.text) as typeof parsed;
      } catch {
        throw new Error('LLM returned non-JSON option match');
      }

      let matched =
        typeof parsed.matched_option === 'string'
          ? parsed.matched_option
          : null;
      if (matched && !list.includes(matched)) {
        const recovered = list.find(
          (opt) => opt.toLowerCase() === matched!.toLowerCase(),
        );
        matched = recovered || null;
      }

      // #region agent log
      try {
        const { appendFile } = await import('fs/promises');
        await appendFile(
          '/Users/robin/Desktop/Utils/AthensAI/.cursor/debug-543c46.log',
          `${JSON.stringify({
            sessionId: '543c46',
            runId: 'post-fix',
            hypothesisId: 'N',
            location: 'oak-match-option.service.ts:parsed',
            message: 'match-option parsed',
            data: {
              optionCount: list.length,
              intendedLen: input.intendedValue.trim().length,
              fieldLabelLen: String(input.fieldLabel || '').trim().length,
              hasMatch: Boolean(matched),
              confidence:
                typeof parsed.confidence === 'number'
                  ? Math.round(parsed.confidence * 100)
                  : 0,
            },
            timestamp: Date.now(),
          })}\n`,
        );
      } catch {
        /* ignore */
      }
      // #endregion

      await this.usage.record({
        feature: AI_USAGE_FEATURES.oakMatchOption,
        applierName: input.applierName,
        path: '/api/oak/match-option',
        provider: auth.provider,
        requestedModel: auth.model,
        billedModel: raw.model,
        apiKey: auth.apiKey,
        usage: {
          promptTokens: raw.usage.inputTokens,
          completionTokens: raw.usage.outputTokens,
          totalTokens: raw.usage.totalTokens,
        },
        cachedTokens: raw.usage.cachedInputTokens,
        startedAt,
        durationMs: Date.now() - t0,
        success: true,
      });

      return {
        ok: true as const,
        matched_option: matched,
        confidence:
          typeof parsed.confidence === 'number' ? parsed.confidence : 0,
        reason: typeof parsed.reason === 'string' ? parsed.reason : '',
        model: raw.model,
        usage: raw.usage,
      };
    } catch (error) {
      // #region agent log
      try {
        const { appendFile } = await import('fs/promises');
        await appendFile(
          '/Users/robin/Desktop/Utils/AthensAI/.cursor/debug-543c46.log',
          `${JSON.stringify({
            sessionId: '543c46',
            runId: 'post-fix',
            hypothesisId: 'G',
            location: 'oak-match-option.service.ts:catch',
            message: 'match-option backend error',
            data: {
              optionCount: list.length,
              errorKind: String(
                error instanceof Error ? error.message : error,
              ).slice(0, 180),
            },
            timestamp: Date.now(),
          })}\n`,
        );
      } catch {
        /* ignore */
      }
      // #endregion
      await this.usage.record({
        feature: AI_USAGE_FEATURES.oakMatchOption,
        applierName: input.applierName,
        path: '/api/oak/match-option',
        provider: auth.provider,
        requestedModel: auth.model,
        apiKey: auth.apiKey,
        startedAt,
        durationMs: Date.now() - t0,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async matchViaChat(
    auth: Awaited<ReturnType<ProfileLlmAuthService['resolve']>>,
    userPrompt: string,
  ) {
    const completion = await this.chat.chatCompletion({
      provider: auth.provider,
      apiKey: auth.apiKey,
      model: auth.model,
      messages: [
        { role: 'system', content: MATCH_OPTION_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      // json_object mode 400s unless the prompt contains "json"; keep
      // structured replies via the prompt and parse the text instead.
      jsonMode: false,
      temperature: 0.1,
    });
    const model = completion.model || auth.model;
    return {
      text: completion.content || '',
      model,
      usage: summarizeUsage(
        {
          prompt_tokens: completion.usage?.promptTokens,
          completion_tokens: completion.usage?.completionTokens,
          total_tokens: completion.usage?.totalTokens,
          prompt_cache_hit_tokens: completion.usage?.cachedTokens,
        },
        model,
      ),
    };
  }
}
