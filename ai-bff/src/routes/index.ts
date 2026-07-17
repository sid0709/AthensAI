import { Router } from 'express';
import { parseCorrelationHeaders } from '@nextoffer/shared/ai-usage';
import { calculateCost, resolveModelPricing } from '../pricing.js';
import type { AiKit } from '../kit.js';
import { asyncHandler, HttpError } from '../middleware/error.js';
import { estimateRequestSchema, estimateTokens, parseChatRequest } from '../validation.js';
import { loadConfigFromEnv } from '../config.js';

export function createRoutes(kit: AiKit) {
  const router = Router();
  const defaults = loadConfigFromEnv();

  router.get(
    '/health',
    asyncHandler(async (_req, res) => {
      res.json({
        ok: true,
        providers: kit.getConfiguredProviders(),
        defaultModel: kit.getDefaultModel(),
      });
    }),
  );

  router.get(
    '/v1/models',
    asyncHandler(async (_req, res) => {
      res.json({ models: kit.listModels() });
    }),
  );

  router.post(
    '/v1/chat',
    asyncHandler(async (req, res) => {
      const body = mergeCorrelation(req, parseChatRequest(req.body));
      const withKeys = applyBearerApiKeys(req, body);
      if (withKeys.stream) {
        throw new HttpError(501, 'Streaming is not implemented yet. Set stream: false.');
      }
      const result = await kit.chat(withKeys);
      res.json(result);
    }),
  );

  /** OpenAI-compatible alias for drop-in clients */
  router.post(
    '/v1/chat/completions',
    asyncHandler(async (req, res) => {
      const openAiBody = req.body as Record<string, unknown>;
      const responseFormat = openAiBody.response_format as { type?: string } | undefined;
      const wantsJsonObject = responseFormat?.type === 'json_object';
      const mapped = mergeCorrelation(req, parseChatRequest({
        model: openAiBody.model,
        system: extractSystemFromOpenAi(openAiBody.messages),
        messages: normalizeOpenAiMessages(openAiBody.messages),
        temperature: openAiBody.temperature,
        maxTokens: openAiBody.max_tokens ?? openAiBody.maxTokens,
        topP: openAiBody.top_p ?? openAiBody.topP,
        stop: openAiBody.stop,
        tools: openAiBody.tools,
        toolChoice: openAiBody.tool_choice ?? openAiBody.toolChoice,
        responseSchema: openAiBody.response_schema ?? openAiBody.responseSchema,
        jsonMode: wantsJsonObject || openAiBody.jsonMode || undefined,
        apiKeys: openAiBody.apiKeys,
        stream: openAiBody.stream,
        requestId: openAiBody.requestId,
        runId: openAiBody.runId,
        applierName: openAiBody.applierName,
        jobId: openAiBody.jobId,
        feature: openAiBody.feature,
      }));
      const withKeys = applyBearerApiKeys(req, mapped);

      if (withKeys.stream) {
        throw new HttpError(501, 'Streaming is not implemented yet. Set stream: false.');
      }

      const result = await kit.chat(withKeys);
      res.json(toOpenAiCompletion(result));
    }),
  );

  router.post(
    '/v1/estimate',
    asyncHandler(async (req, res) => {
      const body = estimateRequestSchema.parse(req.body);
      const model = body.model ?? defaults.defaultModel ?? 'gpt-4o-mini';
      const pricing = resolveModelPricing(model);
      const promptTokens = estimateTokens(body.promptText);
      const completionTokens = body.expectedCompletionTokens;
      const usage = {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      };
      res.json({
        model,
        provider: pricing.provider,
        usage,
        cost: calculateCost(model, usage),
      });
    }),
  );

  return router;
}

function mergeCorrelation(req: import('express').Request, body: import('../types.js').ChatRequest) {
  const headers = parseCorrelationHeaders(req);
  return {
    ...body,
    requestId: body.requestId || headers.requestId,
    runId: body.runId || headers.runId,
    applierName: body.applierName || headers.applierName,
    jobId: body.jobId || headers.jobId,
    feature: body.feature || headers.feature,
  };
}

/** Accept Authorization: Bearer <key> and map onto apiKeys by model family. */
function applyBearerApiKeys(
  req: import('express').Request,
  body: import('../types.js').ChatRequest,
): import('../types.js').ChatRequest {
  const auth = req.headers.authorization;
  const bearer =
    typeof auth === 'string' && /^Bearer\s+/i.test(auth)
      ? auth.replace(/^Bearer\s+/i, '').trim()
      : '';
  if (!bearer) return body;

  const model = String(body.model || '').toLowerCase();
  const isDeepseek = model.startsWith('deepseek');
  return {
    ...body,
    apiKeys: {
      ...(body.apiKeys || {}),
      ...(isDeepseek
        ? { deepseek: body.apiKeys?.deepseek || bearer }
        : { openai: body.apiKeys?.openai || bearer }),
    },
  };
}

function extractSystemFromOpenAi(messages: unknown): string | undefined {
  if (!Array.isArray(messages)) return undefined;
  const system = messages.find((m) => m && typeof m === 'object' && (m as { role?: string }).role === 'system');
  if (!system || typeof system !== 'object') return undefined;
  const content = (system as { content?: unknown }).content;
  return typeof content === 'string' ? content : undefined;
}

function normalizeOpenAiMessages(messages: unknown) {
  if (!Array.isArray(messages)) {
    throw new HttpError(400, 'messages must be an array');
  }

  return messages
    .filter((m) => m && typeof m === 'object' && (m as { role?: string }).role !== 'system')
    .map((m) => {
      const msg = m as {
        role: 'user' | 'assistant' | 'tool';
        content?: unknown;
        name?: string;
        tool_call_id?: string;
      };

      if (typeof msg.content === 'string') {
        return {
          role: msg.role,
          content: msg.content,
          name: msg.name,
          toolCallId: msg.tool_call_id,
        };
      }

      if (Array.isArray(msg.content)) {
        const textParts = msg.content
          .filter((part) => part && typeof part === 'object' && (part as { type?: string }).type === 'text')
          .map((part) => (part as { text?: string }).text ?? '')
          .join('\n');
        const images = msg.content
          .filter((part) => part && typeof part === 'object' && (part as { type?: string }).type === 'image_url')
          .map((part) => {
            const imageUrl = (part as { image_url?: { url?: string; detail?: string } }).image_url;
            return {
              url: imageUrl?.url ?? '',
              detail: imageUrl?.detail as 'auto' | 'low' | 'high' | undefined,
            };
          })
          .filter((img) => img.url);

        return {
          role: msg.role,
          content: textParts,
          images: images.length ? images : undefined,
        };
      }

      return {
        role: msg.role,
        content: '',
        name: msg.name,
        toolCallId: msg.tool_call_id,
      };
    });
}

function toOpenAiCompletion(result: Awaited<ReturnType<AiKit['chat']>>) {
  return {
    id: result.id,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: result.model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: result.content,
          tool_calls: result.toolCalls?.map((call) => ({
            id: call.id,
            type: 'function',
            function: { name: call.name, arguments: call.arguments },
          })),
        },
        finish_reason: result.finishReason,
      },
    ],
    usage: {
      prompt_tokens: result.usage.promptTokens,
      completion_tokens: result.usage.completionTokens,
      total_tokens: result.usage.totalTokens,
      ...(result.usage.cachedTokens
        ? { prompt_tokens_details: { cached_tokens: result.usage.cachedTokens } }
        : {}),
    },
    avalon: {
      requestId: result.requestId,
      requestedModel: result.requestedModel,
      billedModel: result.billedModel,
      modelMismatch: result.modelMismatch,
      provider: result.provider,
      structured: result.structured,
      cost: result.usage.cost,
    },
  };
}
