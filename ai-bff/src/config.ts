import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { normalizeApiKey } from './api-keys.js';
import type { AiKitConfig } from './types.js';

loadEnv({ path: resolve(process.cwd(), '.env') });

function readNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadConfigFromEnv(): AiKitConfig {
  return {
    openaiApiKey: normalizeApiKey(process.env.OPENAI_API_KEY),
    openaiBaseUrl: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
    deepseekApiKey: normalizeApiKey(process.env.DEEPSEEK_API_KEY),
    deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
    defaultModel: process.env.DEFAULT_MODEL ?? 'gpt-4o-mini',
  };
}

export const serverConfig = {
  port: readNumber(process.env.PORT, 3920),
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
  mongoUri: process.env.MONGO_URL || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017',
  mongoDb: process.env.MONGO_DB || 'AthensDB',
};
