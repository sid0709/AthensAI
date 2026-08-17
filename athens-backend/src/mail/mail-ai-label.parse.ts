import { asText } from '../personal/mappers/as-text';
import { ALL_MAIL_PATH } from './constants/mail.constants';

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

export type MailAiLabelLoaded = {
  id: string;
  mailbox: string;
  uid: number;
  from: string;
  subject: string;
  preview: string;
  bodyText: string;
  gmailLabels: string[];
};

export function parseJsonLoose(text: string): unknown {
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

export function resolveCanonicalLabel(
  raw: unknown,
  allowedLabels: string[],
): string | null {
  const candidate = asText(raw).trim();
  if (!candidate) return null;
  const exact = allowedLabels.find((label) => label === candidate);
  if (exact) return exact;
  const lower = candidate.toLowerCase();
  return allowedLabels.find((label) => label.toLowerCase() === lower) || null;
}

export function parseMessageId(raw: string): { mailbox: string; uid: number } {
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

export function formatEmailText(
  email: MailAiLabelLoaded,
  maxChars: number,
): string {
  const body = (email.bodyText || email.preview || '')
    .trim()
    .slice(0, Math.max(1, maxChars));
  return [
    `From: ${email.from}`,
    `Subject: ${email.subject}`,
    `Body:\n${body}`,
  ].join('\n');
}

/** Map model JSON onto requested ids. Null means parse failed. */
export function parseClassifyResults(
  text: string,
  ids: string[],
): Record<string, string | null> | null {
  const parsed = parseJsonLoose(text) as {
    results?: Array<{ id?: unknown; label?: unknown }>;
  } | null;
  if (!parsed || !Array.isArray(parsed.results)) return null;
  const byId = new Map<string, string | null>();
  for (const row of parsed.results) {
    const id = asText(row?.id).trim();
    if (!id) continue;
    byId.set(id, row?.label == null ? null : asText(row.label));
  }
  const out: Record<string, string | null> = {};
  for (const id of ids) {
    out[id] = byId.has(id) ? byId.get(id)! : null;
  }
  return out;
}

export function mergeUsage(
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
        : (av ?? bv);
  }
  return out;
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === 'AbortError') ||
    (typeof error === 'object' &&
      error !== null &&
      'name' in error &&
      (error as { name?: string }).name === 'AbortError')
  );
}
