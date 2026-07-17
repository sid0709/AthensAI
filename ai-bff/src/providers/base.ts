import OpenAI from 'openai';
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions';
import { resolveModelPricing } from '../pricing.js';
import { parseStructuredContent, preparePromptOnlyStructured, prepareStructuredChat } from '../structured-output.js';
import type { AiProviderId, ProviderChatParams } from '../types.js';

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
}

async function createCompletion(
  client: OpenAI,
  body: ChatCompletionCreateParamsNonStreaming,
): Promise<ChatCompletion> {
  return client.chat.completions.create(body);
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
        max_tokens: params.maxTokens,
        top_p: params.topP,
        stop: params.stop,
        tools: params.tools,
        tool_choice: params.toolChoice,
        response_format: responseFormat,
      };

      let completion: ChatCompletion;
      try {
        completion = await createCompletion(client, body);
      } catch (error) {
        // Some DeepSeek models reject json_object — fall back to prompt-only JSON
        if (
          id === 'deepseek' &&
          params.responseSchema &&
          structured.responseFormat &&
          isResponseFormatError(error)
        ) {
          const fallback = prepareStructuredChat(id, params.messages, params.responseSchema);
          fallback.responseFormat = undefined;
          completion = await createCompletion(client, {
            ...body,
            messages: fallback.messages,
            response_format: undefined,
          });
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
