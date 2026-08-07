import { Injectable } from '@nestjs/common';
import { LLM_CHAT_TIMEOUT_MS } from '../constants/ai-concurrency.constants';
import {
  abortError,
  isRetryableStatus,
  PROVIDER_BASE,
  resolveResponseFormat,
} from './openai-provider';
import type {
  ChatCompletionInput,
  ChatCompletionResult,
  ChatStreamEvent,
} from './openai.types';

/**
 * OpenAI-compatible streaming chat (OpenAI + DeepSeek).
 * Yields `delta` tokens then a final `done` with usage/timing.
 */
@Injectable()
export class OpenAiChatStreamService {
  async *chatCompletionStream(
    input: ChatCompletionInput,
  ): AsyncGenerator<ChatStreamEvent> {
    const provider = input.provider ?? 'openai';
    const base = PROVIDER_BASE[provider] ?? PROVIDER_BASE.openai;
    const timeoutMs = input.timeoutMs ?? LLM_CHAT_TIMEOUT_MS;
    const responseFormat = resolveResponseFormat(provider, input);
    const body: Record<string, unknown> = {
      model: input.model,
      messages: input.messages,
      stream: true,
      ...(responseFormat ? { response_format: responseFormat } : {}),
      ...(typeof input.temperature === 'number'
        ? { temperature: input.temperature }
        : {}),
    };
    // OpenAI-only; DeepSeek ignores / rejects unknown stream_options.
    if (provider === 'openai') {
      body.stream_options = { include_usage: true };
    }

    if (input.signal?.aborted) throw abortError(input.signal);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onOuterAbort = () => controller.abort();
    input.signal?.addEventListener('abort', onOuterAbort, { once: true });

    const startedAt = Date.now();
    let ttftMs: number | null = null;
    let billedModel = input.model;
    let usage: ChatCompletionResult['usage'] = null;

    try {
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const err = new Error(
          `LLM HTTP ${res.status}: ${text.slice(0, 400)}`,
        ) as Error & { retryable?: boolean; status?: number };
        err.status = res.status;
        err.retryable = isRetryableStatus(res.status);
        throw err;
      }
      if (!res.body) {
        throw Object.assign(new Error('LLM returned an empty stream body'), {
          retryable: true,
        });
      }

      yield* readProviderSse(res.body, input.signal, {
        onDelta: (text) => {
          if (ttftMs == null) ttftMs = Date.now() - startedAt;
          return text;
        },
        onMeta: (meta) => {
          if (meta.model) billedModel = meta.model;
          if (meta.usage) usage = meta.usage;
        },
      });

      yield {
        type: 'done',
        model: billedModel,
        usage,
        durationMs: Date.now() - startedAt,
        ttftMs,
      };
    } catch (err) {
      if (input.signal?.aborted || controller.signal.aborted) {
        throw abortError(input.signal);
      }
      throw err;
    } finally {
      clearTimeout(timer);
      input.signal?.removeEventListener('abort', onOuterAbort);
    }
  }
}

type StreamMeta = {
  model?: string;
  usage?: ChatCompletionResult['usage'];
};

async function* readProviderSse(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal | undefined,
  hooks: {
    onDelta: (text: string) => string;
    onMeta: (meta: StreamMeta) => void;
  },
): AsyncGenerator<ChatStreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    if (signal?.aborted) throw abortError(signal);
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      let parsed: {
        model?: string;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
        };
        error?: { message?: string } | string;
        choices?: Array<{ delta?: { content?: string }; text?: string }>;
      };
      try {
        parsed = JSON.parse(payload) as typeof parsed;
      } catch {
        continue;
      }
      if (parsed.error) {
        const msg =
          typeof parsed.error === 'string'
            ? parsed.error
            : parsed.error.message;
        throw new Error(msg || 'LLM stream failed');
      }
      const meta: StreamMeta = {};
      if (parsed.model) meta.model = parsed.model;
      if (parsed.usage) {
        meta.usage = {
          promptTokens: Number(parsed.usage.prompt_tokens ?? 0),
          completionTokens: Number(parsed.usage.completion_tokens ?? 0),
          totalTokens: Number(parsed.usage.total_tokens ?? 0),
        };
      }
      if (meta.model || meta.usage) hooks.onMeta(meta);
      const delta =
        parsed.choices?.[0]?.delta?.content ??
        parsed.choices?.[0]?.text ??
        '';
      if (delta) {
        yield { type: 'delta', text: hooks.onDelta(String(delta)) };
      }
    }
  }
}
