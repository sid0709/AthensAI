import { Injectable } from '@nestjs/common';
import { OpenAiChatService } from '../ai/openai/openai-chat.service';
import { ProfileLlmAuthService } from '../ai/auth/profile-llm-auth.service';
import { ALL_MAIL_PATH } from './constants/mail.constants';
import { ImapClientService } from './imap/imap-client.service';
import { MailCacheService } from './mail-cache.service';
import { MailLabelDefinitionsService } from './mail-label-definitions.service';
import type { MailCredentialsOk } from './mail-credentials.service';

export type MailAiLabelResult = {
  uid: number;
  label: string | null;
  applied: boolean;
  reason?:
    | 'applied'
    | 'no_match'
    | 'body_error'
    | 'classification_error'
    | 'gmail_error';
  error?: string;
};

export type MailAiLabelProgress = {
  total: number;
  completed: number;
  failed: number;
  applied: number;
  skipped: number;
  phase:
    | 'loading_snippets'
    | 'classifying_snippet'
    | 'loading_body'
    | 'classifying_body'
    | 'labeling'
    | 'done';
  items?: Record<string, { result?: MailAiLabelResult }>;
};

function parseJsonLoose(text: string): unknown {
  const raw = String(text ?? '').trim();
  try {
    return JSON.parse(raw);
  } catch {
    /* fall through */
  }
  const fenced = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  const first = fenced.indexOf('{');
  const last = fenced.lastIndexOf('}');
  if (first !== -1 && last > first) {
    try {
      return JSON.parse(fenced.slice(first, last + 1));
    } catch {
      /* fall through */
    }
  }
  return null;
}

function resolveCanonicalLabel(
  raw: unknown,
  allowedLabels: string[],
): string | null {
  const candidate = String(raw ?? '').trim();
  if (!candidate) return null;
  const exact = allowedLabels.find((label) => label === candidate);
  if (exact) return exact;
  const lower = candidate.toLowerCase();
  return allowedLabels.find((label) => label.toLowerCase() === lower) || null;
}

function parseMessageId(raw: string): { mailbox: string; uid: number } {
  const s = String(raw || '');
  if (s.includes('\0')) {
    const [mailbox, uidStr] = s.split('\0');
    return {
      mailbox: mailbox || ALL_MAIL_PATH,
      uid: Number(uidStr),
    };
  }
  return { mailbox: 'INBOX', uid: Number(s) };
}

@Injectable()
export class MailAiLabelService {
  constructor(
    private readonly llmAuth: ProfileLlmAuthService,
    private readonly chat: OpenAiChatService,
    private readonly imap: ImapClientService,
    private readonly cache: MailCacheService,
    private readonly definitions: MailLabelDefinitionsService,
  ) {}

  async prepare(creds: MailCredentialsOk, messageIds: string[]) {
    const auth = await this.llmAuth.resolve({
      applierName: creds.applierName,
    });
    const labels = await this.imap.fetchGmailLabelList(
      creds.email,
      creds.password,
    );
    const allowedLabels = labels.map((l) => l.path || l.name).filter(Boolean);
    if (!allowedLabels.length) {
      throw new Error('Create at least one custom Gmail label before AI labeling.');
    }
    const labelDefinitions = await this.definitions.get(creds.applierName);
    return {
      auth,
      allowedLabels,
      labelDefinitions,
      messageIds: messageIds.slice(0, 50),
    };
  }

  async runBatch(input: {
    creds: MailCredentialsOk;
    messageIds: string[];
    onProgress?: (progress: MailAiLabelProgress) => Promise<void> | void;
    signal?: AbortSignal;
  }) {
    const started = Date.now();
    const prepared = await this.prepare(input.creds, input.messageIds);
    const results: MailAiLabelResult[] = [];
    const items: Record<string, { result?: MailAiLabelResult }> = {};
    let completed = 0;
    let applied = 0;
    let failed = 0;
    let skipped = 0;
    let usage: Record<string, unknown> | undefined;
    let aiRequests = 0;

    const report = async (
      phase: MailAiLabelProgress['phase'],
      extra?: Partial<MailAiLabelProgress>,
    ) => {
      await input.onProgress?.({
        total: prepared.messageIds.length,
        completed,
        failed,
        applied,
        skipped,
        phase,
        items,
        ...extra,
      });
    };

    await report('loading_snippets');

    const catalog = prepared.allowedLabels.map((name) => ({
      name,
      description: String(prepared.labelDefinitions[name] || '').trim(),
    }));

    for (const id of prepared.messageIds) {
      if (input.signal?.aborted) break;
      const { mailbox, uid } = parseMessageId(id);
      if (!Number.isFinite(uid)) {
        const r: MailAiLabelResult = {
          uid: 0,
          label: null,
          applied: false,
          reason: 'body_error',
          error: 'Invalid message id',
        };
        results.push(r);
        items[id] = { result: r };
        failed += 1;
        completed += 1;
        continue;
      }

      try {
        let cached = await this.cache.getMessage(
          input.creds.applierName,
          uid,
          mailbox,
        );
        if (!cached) {
          const env = await this.imap.fetchEnvelopeForUid(
            input.creds.email,
            input.creds.password,
            uid,
            input.creds.applierName,
            mailbox,
          );
          if (env) {
            await this.cache.upsertMessages([env]);
            cached = await this.cache.getMessage(
              input.creds.applierName,
              uid,
              mailbox,
            );
          }
        }
        if (!cached) {
          throw new Error('Message not found');
        }

        await report('classifying_snippet');
        const snippetText = [
          `From: ${cached.fromName || cached.fromEmail || ''}`,
          `Subject: ${cached.subject}`,
          `Snippet: ${cached.preview || ''}`,
        ].join('\n');

        const snippetResult = await this.classifySnippet({
          auth: prepared.auth,
          catalog,
          id,
          text: snippetText,
        });
        aiRequests += 1;
        usage = mergeUsage(usage, snippetResult.usage);

        let label: string | null = null;
        if (snippetResult.action === 'label') {
          label = resolveCanonicalLabel(
            snippetResult.label,
            prepared.allowedLabels,
          );
        } else if (snippetResult.action === 'needs_body') {
          await report('loading_body');
          const bodyText = await this.imap.fetchMessagePlainText(
            input.creds.email,
            input.creds.password,
            uid,
            mailbox,
            4000,
          );
          await report('classifying_body');
          const bodyResult = await this.classifyBody({
            auth: prepared.auth,
            catalog,
            id,
            text: [
              `From: ${cached.fromName || cached.fromEmail || ''}`,
              `Subject: ${cached.subject}`,
              `Body:\n${bodyText}`,
            ].join('\n'),
          });
          aiRequests += 1;
          usage = mergeUsage(usage, bodyResult.usage);
          label = resolveCanonicalLabel(
            bodyResult.label,
            prepared.allowedLabels,
          );
        }

        if (!label) {
          const r: MailAiLabelResult = {
            uid,
            label: null,
            applied: false,
            reason: 'no_match',
          };
          results.push(r);
          items[id] = { result: r };
          skipped += 1;
          completed += 1;
          await report('labeling');
          continue;
        }

        await report('labeling');
        await this.imap.addLabelsToMessages(
          input.creds.email,
          input.creds.password,
          [uid],
          [label],
          mailbox,
          { signal: input.signal },
        );
        const nextLabels = [...new Set([...(cached.gmailLabels || []), label])];
        await this.cache.updateMessageFlags(
          input.creds.applierName,
          uid,
          { gmailLabels: nextLabels },
          mailbox,
        );
        const r: MailAiLabelResult = {
          uid,
          label,
          applied: true,
          reason: 'applied',
        };
        results.push(r);
        items[id] = { result: r };
        applied += 1;
        completed += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const r: MailAiLabelResult = {
          uid,
          label: null,
          applied: false,
          reason: /IMAP|Gmail|label/i.test(message)
            ? 'gmail_error'
            : 'classification_error',
          error: message,
        };
        results.push(r);
        items[id] = { result: r };
        failed += 1;
        completed += 1;
      }
    }

    await report('done');
    return {
      results,
      usage,
      model: {
        provider: prepared.auth.provider,
        model: prepared.auth.model,
      },
      processing: {
        durationMs: Date.now() - started,
        messages: prepared.messageIds.length,
        aiRequests,
        gmailWriteBatches: applied,
        snippetFetchMs: 0,
        bodyFetchMs: 0,
        aiRequestMs: 0,
        gmailWriteMs: 0,
        snippetCacheHits: 0,
        fullBodyFallbacks: 0,
        firstResultMs: null as number | null,
      },
    };
  }

  private async classifySnippet(input: {
    auth: { provider: 'openai' | 'deepseek'; apiKey: string; model: string };
    catalog: Array<{ name: string; description: string }>;
    id: string;
    text: string;
  }) {
    const result = await this.chat.chatCompletion({
      provider: input.auth.provider,
      apiKey: input.auth.apiKey,
      model: input.auth.model,
      jsonMode: true,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: [
            'You classify emails into custom Gmail labels using only sender, subject, and a short snippet.',
            'For every email choose exactly one action: "label", "no_match", or "needs_body".',
            'Return ONLY JSON: { "results": [{ "id": string, "action": "label"|"no_match"|"needs_body", "label": string|null }] }.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: JSON.stringify({
            allowedLabels: input.catalog,
            emails: [{ id: input.id, text: input.text }],
          }),
        },
      ],
    });
    const parsed = parseJsonLoose(String(result.content || '')) as {
      results?: Array<{ action?: string; label?: string | null }>;
    } | null;
    const row = parsed?.results?.[0];
    return {
      action: (row?.action || 'needs_body') as
        | 'label'
        | 'no_match'
        | 'needs_body',
      label: row?.label ?? null,
      usage: result.usage as Record<string, unknown> | undefined,
    };
  }

  private async classifyBody(input: {
    auth: { provider: 'openai' | 'deepseek'; apiKey: string; model: string };
    catalog: Array<{ name: string; description: string }>;
    id: string;
    text: string;
  }) {
    const result = await this.chat.chatCompletion({
      provider: input.auth.provider,
      apiKey: input.auth.apiKey,
      model: input.auth.model,
      jsonMode: true,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: [
            'You classify each email into exactly ONE custom Gmail label from the provided list.',
            'If no label is a reasonable fit, return null for that email label.',
            'Return ONLY JSON: { "results": [{ "id": string, "label": string|null }] }.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: JSON.stringify({
            allowedLabels: input.catalog,
            emails: [{ id: input.id, text: input.text }],
          }),
        },
      ],
    });
    const parsed = parseJsonLoose(String(result.content || '')) as {
      results?: Array<{ label?: string | null }>;
    } | null;
    return {
      label: parsed?.results?.[0]?.label ?? null,
      usage: result.usage as Record<string, unknown> | undefined,
    };
  }
}

function mergeUsage(
  a?: Record<string, unknown>,
  b?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!a && !b) return undefined;
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const av = a?.[key];
    const bv = b?.[key];
    out[key] =
      typeof av === 'number' || typeof bv === 'number'
        ? (typeof av === 'number' ? av : 0) + (typeof bv === 'number' ? bv : 0)
        : av ?? bv;
  }
  return out;
}
