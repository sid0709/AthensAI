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
