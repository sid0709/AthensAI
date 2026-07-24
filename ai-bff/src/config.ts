import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeApiKey } from './api-keys.js';
import type { AiKitConfig } from './types.js';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const localEnvPath = resolve(moduleDir, '../.env');
const sharedRuntimeEnvPath = resolve(moduleDir, '../../Athens-server/.env');
loadEnv({ path: localEnvPath });
// Athens-server owns the shared local database/runtime selection. Service-local
// AI keys keep precedence, while Firestore settings fill in missing values.
loadEnv({ path: sharedRuntimeEnvPath });

const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
if (credentialPath && !isAbsolute(credentialPath)) {
  const resolvedCredentialPath = resolve(dirname(sharedRuntimeEnvPath), credentialPath);
  if (existsSync(resolvedCredentialPath)) process.env.GOOGLE_APPLICATION_CREDENTIALS = resolvedCredentialPath;
}

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
