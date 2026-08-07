import { DEEPSEEK_MODELS } from '@nextoffer/shared/models';

/** Official Chat Completions models (DeepSeek V4). */
export const DEEPSEEK_CHAT_MODELS = [...DEEPSEEK_MODELS] as const;

export const DEEPSEEK_DEFAULT_MODEL = 'deepseek-v4-flash';

/** Static fallback when DeepSeek /models is unreachable. */
export const DEEPSEEK_FALLBACK_MODELS = [...DEEPSEEK_CHAT_MODELS];

/** Casual / legacy IDs → current API model IDs. */
const MODEL_ALIASES: Record<string, string> = {
  'deepseek-flash-v4': 'deepseek-v4-flash',
  'deepseek-v4': 'deepseek-v4-flash',
  'deepseek-chat': 'deepseek-v4-flash',
  'deepseek-reasoner': 'deepseek-v4-flash',
  'deepseek-coder': 'deepseek-v4-flash',
  'v4-flash': 'deepseek-v4-flash',
  'flash-v4': 'deepseek-v4-flash',
  'deepseek-pro-v4': 'deepseek-v4-pro',
  'deepseek-v4pro': 'deepseek-v4-pro',
  'v4-pro': 'deepseek-v4-pro',
  'pro-v4': 'deepseek-v4-pro',
};

/**
 * Map profile / UI model strings onto DeepSeek's current API IDs.
 * Unknown `deepseek-*` strings pass through unchanged.
 */
export function normalizeDeepSeekModel(model: string): string {
  const raw = String(model || '').trim();
  if (!raw) return DEEPSEEK_DEFAULT_MODEL;
  const key = raw.toLowerCase();
  if (MODEL_ALIASES[key]) return MODEL_ALIASES[key];
  return raw;
}

export async function listDeepSeekModels(apiKey: string): Promise<string[]> {
  const res = await fetch('https://api.deepseek.com/models', {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`DeepSeek models ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    data?: Array<{ id?: string }>;
  };
  const ids = (data.data || [])
    .map((m) => String(m.id || '').trim())
    .filter(Boolean)
    .sort();
  return ids.length ? ids : [...DEEPSEEK_CHAT_MODELS];
}
