import { MongoClient, type Collection } from 'mongodb';
import {
  AI_API_USAGE_COLLECTION,
  createAiApiUsageRecorder,
  ensureAiApiUsageIndexes,
} from '@nextoffer/shared/ai-api-usage';
import { serverConfig } from './config.js';

let client: MongoClient | null = null;
let usageCollection: Collection | null = null;
let recordUsage: ReturnType<typeof createAiApiUsageRecorder> | null = null;

export async function initDb() {
  if (!serverConfig.mongoUri) {
    console.warn('[mongo] MONGO_URL not set — ai_api_usage recording disabled');
    recordUsage = createAiApiUsageRecorder(null);
    return;
  }
  try {
    client = new MongoClient(serverConfig.mongoUri);
    await client.connect();
    const db = client.db(serverConfig.mongoDb);
    usageCollection = db.collection(AI_API_USAGE_COLLECTION);
    await ensureAiApiUsageIndexes(usageCollection);
    recordUsage = createAiApiUsageRecorder(usageCollection);
    console.log(`[mongo] connected — ${serverConfig.mongoDb}.${AI_API_USAGE_COLLECTION}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[mongo] connection failed — ai_api_usage recording disabled: ${message}`);
    recordUsage = createAiApiUsageRecorder(null);
  }
}

export function getRecordAiApiUsage() {
  if (!recordUsage) recordUsage = createAiApiUsageRecorder(null);
  return recordUsage;
}

/** @deprecated Use getRecordAiApiUsage */
export function getRecordCallLog() {
  return getRecordAiApiUsage();
}

export async function closeDb() {
  if (client) await client.close();
}
