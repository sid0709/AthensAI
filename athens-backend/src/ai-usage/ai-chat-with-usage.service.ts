import { Injectable } from '@nestjs/common';
import { OpenAiChatService } from '../ai/openai/openai-chat.service';
import type {
  ChatCompletionInput,
  ChatCompletionResult,
} from '../ai/openai/openai.types';
import {
  AiUsageRecorderService,
  type AiUsageRecordMeta,
} from './ai-usage-recorder.service';

export type ChatWithUsageInput = ChatCompletionInput & {
  usageMeta?: AiUsageRecordMeta;
};

/**
 * Thin wrapper: OpenAI chat + optional ai_api_usage persist when usageMeta set.
 */
@Injectable()
export class AiChatWithUsageService {
  constructor(
    private readonly chat: OpenAiChatService,
    private readonly recorder: AiUsageRecorderService,
  ) {}

  async chatCompletion(
    input: ChatWithUsageInput,
  ): Promise<ChatCompletionResult> {
    const startedAt = new Date();
    const t0 = Date.now();
    const meta = input.usageMeta;
    try {
      const result = await this.chat.chatCompletion(input);
      if (meta) {
        await this.recorder.record({
          ...meta,
          provider: input.provider ?? 'openai',
          requestedModel: input.model,
          billedModel: result.model || input.model,
          apiKey: input.apiKey,
          usage: result.usage,
          startedAt,
          durationMs: Date.now() - t0,
          success: true,
        });
      }
      return result;
    } catch (err) {
      if (meta) {
        const message = err instanceof Error ? err.message : String(err);
        const status = (err as { status?: number })?.status;
        await this.recorder.record({
          ...meta,
          provider: input.provider ?? 'openai',
          requestedModel: input.model,
          billedModel: input.model,
          apiKey: input.apiKey,
          usage: null,
          startedAt,
          durationMs: Date.now() - t0,
          success: false,
          httpStatus: typeof status === 'number' ? status : undefined,
          error: message,
        });
      }
      throw err;
    }
  }
}
