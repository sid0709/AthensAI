import { Injectable } from '@nestjs/common';
import {
  LLM_CHAT_RETRIES,
  LLM_CHAT_TIMEOUT_MS,
} from '../constants/ai-concurrency.constants';
import { extractChatMessageContent } from './deepseek';
import {
  abortError,
  buildChatCompletionBody,
  isRetryableStatus,
  PROVIDER_BASE,
} from './openai-provider';
import type { ChatCompletionInput, ChatCompletionResult } from './openai.types';

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal));
      return;
    }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError(signal));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Thin OpenAI-compatible chat client (OpenAI + DeepSeek).
 * Callers supply messages; no domain prompts live here.
 */
@Injectable()
export class OpenAiChatService {
  async chatCompletion(
    input: ChatCompletionInput,
  ): Promise<ChatCompletionResult> {
    const provider = input.provider ?? 'openai';
    const base = PROVIDER_BASE[provider] ?? PROVIDER_BASE.openai;
    const timeoutMs = input.timeoutMs ?? LLM_CHAT_TIMEOUT_MS;
    const retries = input.retries ?? LLM_CHAT_RETRIES;
    const body = buildChatCompletionBody(provider, input);

    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      if (input.signal?.aborted) throw abortError(input.signal);
      try {
        return await this.once(
          base,
          input.apiKey,
          body,
          timeoutMs,
          input.signal,
        );
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (lastError.name === 'AbortError') throw lastError;
        const retryable =
          (lastError as Error & { retryable?: boolean }).retryable !== false;
        if (!retryable || attempt >= retries) throw lastError;
        const backoff = Math.min(8_000, 400 * 2 ** attempt);
        await sleep(backoff, input.signal);
      }
    }
    throw lastError ?? new Error('LLM chat failed');
  }

  private async once(
    base: string,
    apiKey: string,
    body: Record<string, unknown>,
    timeoutMs: number,
    outerSignal?: AbortSignal,
  ): Promise<ChatCompletionResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onOuterAbort = () => controller.abort();
    outerSignal?.addEventListener('abort', onOuterAbort, { once: true });

    try {
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const text = await res.text();
      if (!res.ok) {
        const err = new Error(
          `LLM HTTP ${res.status}: ${text.slice(0, 400)}`,
        ) as Error & { retryable?: boolean; status?: number };
        err.status = res.status;
        err.retryable = isRetryableStatus(res.status);
        throw err;
      }

      let data: {
        choices?: Array<{
          message?: {
            content?: string | null;
            reasoning_content?: string | null;
          };
        }>;
        model?: string;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
        };
      };
      try {
        data = JSON.parse(text) as typeof data;
      } catch {
        throw Object.assign(new Error('LLM returned non-JSON body'), {
          retryable: false,
        });
      }

      const content = extractChatMessageContent(data.choices?.[0]?.message);
      if (!content.trim()) {
        throw Object.assign(new Error('LLM returned empty content'), {
          retryable: true,
        });
      }

      const usage = data.usage
        ? {
            promptTokens: Number(data.usage.prompt_tokens ?? 0),
            completionTokens: Number(data.usage.completion_tokens ?? 0),
            totalTokens: Number(data.usage.total_tokens ?? 0),
          }
        : null;

      return {
        content,
        model: String(
          typeof data.model === 'string'
            ? data.model
            : typeof body.model === 'string'
              ? body.model
              : '',
        ),
        usage,
      };
    } catch (err) {
      if (outerSignal?.aborted || controller.signal.aborted) {
        throw abortError(outerSignal);
      }
      throw err;
    } finally {
      clearTimeout(timer);
      outerSignal?.removeEventListener('abort', onOuterAbort);
    }
  }
}
