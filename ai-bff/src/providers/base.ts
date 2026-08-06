import OpenAI from 'openai';
import type {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions';
import { resolveModelPricing } from '../pricing.js';
import { parseStructuredContent, preparePromptOnlyStructured, prepareStructuredChat } from '../structured-output.js';
import type { AiProviderId, ProviderChatParams } from '../types.js';

type OpenAiReasoningEffort = NonNullable<ChatCompletionCreateParamsNonStreaming['reasoning_effort']>;

export interface ProviderRunResult {
  id: string;
  model: string;
  content: string | null;
  structured?: unknown;
  finishReason: string | null;
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens: number;
  raw: ChatCompletion;
}

export interface AiProvider {
  id: AiProviderId;
  isConfigured(): boolean;
  supportsModel(model: string): boolean;
  chat(params: ProviderChatParams): Promise<ProviderRunResult>;
  streamChat(params: ProviderChatParams): AsyncGenerator<ChatCompletionChunk, void, unknown>;
}

function isOpenAiReasoningModel(model: string) {
  return /^(gpt-5|o1|o3|o4)/i.test(model);
}

function buildChatBody(
  id: AiProviderId,
  params: ProviderChatParams,
  stream: boolean,
): ChatCompletionCreateParamsNonStreaming | ChatCompletionCreateParamsStreaming {
  // Streaming + json_object often delays first tokens. Prefer prompt-only JSON guidance.
  let messages = params.messages;
  let responseFormat: ChatCompletionCreateParamsNonStreaming['response_format'] | undefined;
  if (stream) {
    if (params.responseSchema) {
      messages = preparePromptOnlyStructured(params.messages, params.responseSchema);
    }
    responseFormat = undefined;
  } else {
    const structured = prepareStructuredChat(id, params.messages, params.responseSchema);
    messages = structured.messages;
    responseFormat = structured.responseFormat
      ?? (params.jsonMode ? { type: 'json_object' as const } : undefined);
  }

  return {
    model: params.model,
    messages,
    stream,
    ...(stream ? { stream_options: { include_usage: true } } : {}),
    ...(params.temperature != null ? { temperature: params.temperature } : {}),
    ...(id === 'openai'
      && isOpenAiReasoningModel(params.model)
      && params.reasoningEffort
      ? {
          reasoning_effort: params.reasoningEffort as OpenAiReasoningEffort,
        }
      : {}),
    top_p: params.topP,
    stop: params.stop,
    tools: params.tools,
    tool_choice: params.toolChoice,
    response_format: responseFormat,
  };
}

async function createCompletion(
  client: OpenAI,
  body: ChatCompletionCreateParamsNonStreaming,
  signal?: AbortSignal,
): Promise<ChatCompletion> {
  return client.chat.completions.create(body, { signal });
}

export function createOpenAiCompatibleProvider(
  id: AiProviderId,
  apiKey: string | undefined,
  baseURL: string,
): AiProvider {
  const client = apiKey ? new OpenAI({ apiKey, baseURL }) : null;

  return {
    id,
    isConfigured() {
      return Boolean(client);
    },
    supportsModel(model: string) {
      const pricing = resolveModelPricing(model);
      return pricing.provider === id;
    },
    async chat(params: ProviderChatParams): Promise<ProviderRunResult> {
      if (!client) {
        throw new Error(`${id} API key is not configured`);
      }

      const structured = prepareStructuredChat(id, params.messages, params.responseSchema);
      const responseFormat = structured.responseFormat
        ?? (params.jsonMode ? { type: 'json_object' as const } : undefined);

      const body: ChatCompletionCreateParamsNonStreaming = {
        model: params.model,
        messages: structured.messages,
        ...(params.temperature != null ? { temperature: params.temperature } : {}),
        ...(id === 'openai'
          && isOpenAiReasoningModel(params.model)
          && params.reasoningEffort
          ? {
              // Only send when callers explicitly set an effort. Omitting the
              // field is the "no reasoning effort" path for gpt-5-nano / Ask AI.
              reasoning_effort: params.reasoningEffort as OpenAiReasoningEffort,
            }
          : {}),
        top_p: params.topP,
        stop: params.stop,
        tools: params.tools,
        tool_choice: params.toolChoice,
        response_format: responseFormat,
      };

      let completion: ChatCompletion;
      try {
        completion = await createCompletion(client, body, params.signal);
      } catch (error) {
        // Some DeepSeek models reject json_object — fall back to prompt-only JSON
        if (
          id === 'deepseek' &&
          params.responseSchema &&
          structured.responseFormat &&
          isResponseFormatError(error)
        ) {
          if (params.signal?.aborted) {
            throw params.signal.reason instanceof Error
              ? params.signal.reason
              : Object.assign(new Error('AI request cancelled'), { name: 'AbortError' });
          }
          const fallback = prepareStructuredChat(id, params.messages, params.responseSchema);
          fallback.responseFormat = undefined;
          completion = await createCompletion(client, {
            ...body,
            messages: fallback.messages,
            response_format: undefined,
          }, params.signal);
        } else {
          throw error;
        }
      }

      const choice = completion.choices[0];
      const message = choice?.message;
      const content = message?.content ?? null;
      let parsed: unknown;

      if (params.responseSchema && content) {
        parsed = parseStructuredContent(content);
      }

      const usage = completion.usage;
      const cachedTokens =
        Number(usage?.prompt_tokens_details?.cached_tokens ?? 0) || 0;

      return {
        id: completion.id,
        model: completion.model,
        content,
        structured: parsed,
        finishReason: choice?.finish_reason ?? null,
        toolCalls: message?.tool_calls?.map((call) => ({
          id: call.id,
          name: call.type === 'function' ? call.function.name : call.type,
          arguments: call.type === 'function' ? call.function.arguments : '{}',
        })),
        promptTokens: usage?.prompt_tokens ?? 0,
        completionTokens: usage?.completion_tokens ?? 0,
        totalTokens: usage?.total_tokens ?? 0,
        cachedTokens,
        raw: completion,
      };
    },

    async *streamChat(params: ProviderChatParams): AsyncGenerator<ChatCompletionChunk, void, unknown> {
      if (!client) {
        throw new Error(`${id} API key is not configured`);
      }
      const body = buildChatBody(id, params, true) as ChatCompletionCreateParamsStreaming;
      const stream = await client.chat.completions.create(body, { signal: params.signal });
      for await (const chunk of stream) {
        yield chunk;
      }
    },
  };
}

function isResponseFormatError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const message = 'message' in error && typeof error.message === 'string' ? error.message : '';
  return message.includes('response_format') || message.includes('json');
}

export function toOpenAiMessages(messages: ProviderChatParams['messages']): ChatCompletionMessageParam[] {
  return messages;
}
