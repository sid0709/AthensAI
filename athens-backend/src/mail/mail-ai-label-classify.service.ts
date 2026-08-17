import { Injectable } from '@nestjs/common';
import type { ProfileLlmAuth } from '../ai/auth/profile-llm-auth.service';
import { AiChatWithUsageService } from '../ai-usage/ai-chat-with-usage.service';
import { AI_USAGE_FEATURES } from '../ai-usage/constants/ai-usage.constants';
import { mergeUsage, parseClassifyResults } from './mail-ai-label.parse';

const CLASSIFY_SYSTEM = [
  'You classify each email into exactly ONE custom Gmail label from the provided list.',
  'Use sender, subject, and the truncated plain-text body.',
  'If no label is a reasonable fit, return null for that email label.',
  'Return ONLY JSON: { "results": [{ "id": string, "label": string|null }] }.',
].join('\n');

export type MailAiLabelCatalogItem = { name: string; description: string };

export type MailAiLabelClassifyItem = { id: string; text: string };

export type MailAiLabelClassifyBatch = {
  labels: Record<string, string | null>;
  usage?: Record<string, unknown>;
  error?: string;
  requests: number;
};

@Injectable()
export class MailAiLabelClassifyService {
  constructor(private readonly chat: AiChatWithUsageService) {}

  async classifyBatch(input: {
    auth: ProfileLlmAuth;
    catalog: MailAiLabelCatalogItem[];
    emails: MailAiLabelClassifyItem[];
    signal?: AbortSignal;
  }): Promise<MailAiLabelClassifyBatch> {
    if (!input.emails.length) return { labels: {}, requests: 0 };
    const first = await this.classifyOnce(input);
    if (!first.error) return { ...first, requests: 1 };
    const retry = await this.classifyOnce(input);
    return {
      labels: retry.labels,
      usage: mergeUsage(first.usage, retry.usage),
      error: retry.error,
      requests: 2,
    };
  }

  private async classifyOnce(input: {
    auth: ProfileLlmAuth;
    catalog: MailAiLabelCatalogItem[];
    emails: MailAiLabelClassifyItem[];
    signal?: AbortSignal;
  }): Promise<Omit<MailAiLabelClassifyBatch, 'requests'>> {
    const ids = input.emails.map((email) => email.id);
    try {
      const result = await this.chat.chatCompletion({
        provider: input.auth.provider,
        apiKey: input.auth.apiKey,
        model: input.auth.model,
        jsonMode: true,
        temperature: 0,
        signal: input.signal,
        messages: [
          { role: 'system', content: CLASSIFY_SYSTEM },
          {
            role: 'user',
            content: JSON.stringify({
              allowedLabels: input.catalog,
              emails: input.emails,
            }),
          },
        ],
        usageMeta: {
          feature: AI_USAGE_FEATURES.mailLabel,
          applierName: input.auth.applierName,
          path: '/mail/ai-label',
        },
      });
      const usage = result.usage as Record<string, unknown> | undefined;
      const labels = parseClassifyResults(String(result.content || ''), ids);
      if (!labels) {
        return {
          labels: emptyLabels(ids),
          usage,
          error: 'Failed to parse classification JSON',
        };
      }
      return { labels, usage };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (input.signal?.aborted) throw err;
      return { labels: emptyLabels(ids), error: message };
    }
  }
}

function emptyLabels(ids: string[]): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const id of ids) out[id] = null;
  return out;
}
