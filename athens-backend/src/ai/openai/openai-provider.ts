import { deepseekThinkingBody } from './deepseek';
import { normalizeDeepSeekModel } from '../../personal/constants/deepseek-models.constants';
import type { ChatCompletionInput } from './openai.types';

export const PROVIDER_BASE: Record<'openai' | 'deepseek', string> = {
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
};

export function abortError(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error
    ? signal.reason
    : Object.assign(new Error('LLM request aborted'), { name: 'AbortError' });
}

export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export function resolveResponseFormat(
  provider: 'openai' | 'deepseek',
  input: ChatCompletionInput,
): Record<string, unknown> | null {
  if (input.jsonSchema && provider === 'openai') {
    return {
      type: 'json_schema',
      json_schema: {
        name: input.jsonSchema.name,
        strict: input.jsonSchema.strict !== false,
        schema: input.jsonSchema.schema,
      },
    };
  }
  if (input.jsonSchema || input.jsonMode) {
    return { type: 'json_object' };
  }
  return null;
}

/** Build OpenAI-compatible chat body (DeepSeek: normalize model + thinking). */
export function buildChatCompletionBody(
  provider: 'openai' | 'deepseek',
  input: ChatCompletionInput,
  extras?: { stream?: boolean },
): Record<string, unknown> {
  const model =
    provider === 'deepseek' ? normalizeDeepSeekModel(input.model) : input.model;
  const responseFormat = resolveResponseFormat(provider, input);
  const body: Record<string, unknown> = {
    model,
    messages: input.messages,
    ...(extras?.stream ? { stream: true } : {}),
    ...(responseFormat ? { response_format: responseFormat } : {}),
    ...(typeof input.temperature === 'number'
      ? { temperature: input.temperature }
      : {}),
  };
  if (provider === 'deepseek') {
    Object.assign(
      body,
      deepseekThinkingBody({
        jsonMode: input.jsonMode,
        jsonSchema: input.jsonSchema,
        thinking: input.thinking,
      }),
    );
  }
  if (extras?.stream && provider === 'openai') {
    body.stream_options = { include_usage: true };
  }
  return body;
}
