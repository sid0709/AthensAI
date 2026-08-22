import { Injectable } from '@nestjs/common';
import { ProfileLlmAuthService } from '../../ai/auth/profile-llm-auth.service';
import { OpenAiChatService } from '../../ai/openai/openai-chat.service';
import { AI_USAGE_FEATURES } from '../../ai-usage/constants/ai-usage.constants';
import { AiUsageRecorderService } from '../../ai-usage/ai-usage-recorder.service';
import { OakFillPolicyService } from '../policy/oak-fill-policy.service';
import { applyApplicantIdentityToPlan } from './applicant-identity';
import { OakIdentityService } from './oak-identity.service';
import { buildAnalyzePrompt } from './oak-prompt';
import { OakProfilePromptService } from './oak-profile-prompt.service';
import { OakProseService } from './oak-prose.service';
import { OakResponsesService } from './oak-responses.service';
import { summarizeUsage } from './oak-pricing';
import { validatePlanShape } from './oak-schema';

@Injectable()
export class OakAnalyzeService {
  constructor(
    private readonly llmAuth: ProfileLlmAuthService,
    private readonly profilePrompt: OakProfilePromptService,
    private readonly responses: OakResponsesService,
    private readonly chat: OpenAiChatService,
    private readonly usage: AiUsageRecorderService,
    private readonly fillPolicy: OakFillPolicyService,
    private readonly prose: OakProseService,
    private readonly identity: OakIdentityService,
  ) {}

  async analyze(input: {
    profileId: string;
    applierName: string;
    pureTree: string;
    metaTree: string;
    page?: unknown;
  }) {
    const policy = await this.fillPolicy.resolveForAnalyze({
      applierName: input.applierName,
      page: input.page,
    });
    const auth = await this.llmAuth.resolve({
      profileId: input.profileId,
      applierName: input.applierName,
    });
    const applicantProfile = await this.profilePrompt.buildApplicantProfileText(
      input.profileId,
    );
    const { systemPrompt, userPrompt } = buildAnalyzePrompt({
      applicantProfile,
      pureTree: input.pureTree,
      metaTree: input.metaTree,
      page: policy.page,
    });

    const startedAt = new Date();
    const t0 = Date.now();
    try {
      const result =
        auth.provider === 'openai'
          ? await this.responses.requestActionPlan(
              { apiKey: auth.apiKey, model: auth.model },
              systemPrompt,
              userPrompt,
            )
          : await this.analyzeViaChat(auth, systemPrompt, userPrompt);

      await this.usage.record({
        feature: AI_USAGE_FEATURES.oakAiAnalyze,
        applierName: input.applierName,
        path: '/api/oak/ai-analyze',
        provider: auth.provider,
        requestedModel: auth.model,
        billedModel: result.model,
        apiKey: auth.apiKey,
        usage: {
          promptTokens: result.usage.inputTokens,
          completionTokens: result.usage.outputTokens,
          totalTokens: result.usage.totalTokens,
        },
        cachedTokens: result.usage.cachedInputTokens,
        startedAt,
        durationMs: Date.now() - t0,
        success: true,
      });

      const applicationAiIndexes =
        await this.identity.classifyApplicationAiIndexes({
          plan: result.plan,
          auth,
          applierName: input.applierName,
          page: policy.page,
        });
      const drafted = this.fillPolicy.applyPlanPolicy(
        applyApplicantIdentityToPlan(result.plan, applicationAiIndexes),
        policy.isAdmin,
      );
      // #region agent log
      fetch('http://127.0.0.1:7376/ingest/22f9a3b0-687c-4d12-9d88-2e1dc29aae31', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Debug-Session-Id': 'fdabab',
        },
        body: JSON.stringify({
          sessionId: 'fdabab',
          runId: 'pre-fix',
          hypothesisId: 'A',
          location: 'oak-analyze.service.ts:drafted',
          message: 'Planner AI-related fill values before writer',
          data: { fills: debugAiFills(drafted) },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      const rewritten = await this.prose.rewriteTypingFills({
        plan: drafted,
        auth,
        applicantProfile,
        applierName: input.applierName,
        page: policy.page,
      });
      const plan = applyApplicantIdentityToPlan(
        rewritten,
        applicationAiIndexes,
      );
      // #region agent log
      fetch('http://127.0.0.1:7376/ingest/22f9a3b0-687c-4d12-9d88-2e1dc29aae31', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Debug-Session-Id': 'fdabab',
        },
        body: JSON.stringify({
          sessionId: 'fdabab',
          runId: 'pre-fix',
          hypothesisId: 'E',
          location: 'oak-analyze.service.ts:final',
          message: 'Final AI-related fill values after writer+identity',
          data: { fills: debugAiFills(plan) },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      return {
        ok: true as const,
        plan,
        model: result.model,
        responseId: result.responseId ?? null,
        usage: result.usage,
      };
    } catch (error) {
      await this.usage.record({
        feature: AI_USAGE_FEATURES.oakAiAnalyze,
        applierName: input.applierName,
        path: '/api/oak/ai-analyze',
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

  private async analyzeViaChat(
    auth: Awaited<ReturnType<ProfileLlmAuthService['resolve']>>,
    systemPrompt: string,
    userPrompt: string,
  ) {
    const completion = await this.chat.chatCompletion({
      provider: auth.provider,
      apiKey: auth.apiKey,
      model: auth.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      jsonMode: true,
      temperature: 0.1,
    });

    let plan: unknown;
    try {
      plan = JSON.parse(completion.content || '');
    } catch {
      throw new Error('LLM returned non-JSON output');
    }
    validatePlanShape(plan);

    const model = completion.model || auth.model;
    return {
      plan: plan,
      model,
      responseId: null as string | null,
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

function debugAiFills(plan: unknown) {
  const actions =
    plan && typeof plan === 'object'
      ? (plan as { actions?: unknown }).actions
      : null;
  if (!Array.isArray(actions)) return [];
  return actions
    .filter((action) => {
      if (!action || typeof action !== 'object') return false;
      const label = String(
        (action as { expected_label?: unknown }).expected_label || '',
      );
      return /\bai\b|llm|artificial intelligence/i.test(label);
    })
    .map((action) => {
      const row = action as {
        action?: unknown;
        expected_role?: unknown;
        element_index?: unknown;
        expected_label?: unknown;
        value?: unknown;
      };
      return {
        action: row.action,
        role: row.expected_role,
        index: row.element_index,
        label: String(row.expected_label || '').slice(0, 90),
        value: String(row.value || '').slice(0, 160),
      };
    });
}
