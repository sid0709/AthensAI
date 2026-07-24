import { MongoClient, type Collection } from 'mongodb';
import {
  AI_API_USAGE_COLLECTION,
  createAiApiUsageRecorder,
  ensureAiApiUsageIndexes,
} from '@nextoffer/shared/ai-api-usage';
import { serverConfig } from './config.js';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';

let client: MongoClient | null = null;
let usageCollection: Collection | null = null;
let recordUsage: ReturnType<typeof createAiApiUsageRecorder> | null = null;

export async function initDb() {
  if (String(process.env.DATABASE_BACKEND || '').toLowerCase() === 'firestore') {
    if (!getApps().length) initializeApp({
      credential: applicationDefault(),
      projectId: process.env.FIREBASE_PROJECT_ID?.trim() || undefined,
    });
    const ref = getFirestore().collection(AI_API_USAGE_COLLECTION);
    const firestoreCollection = {
      async insertOne(doc: Record<string, unknown>) {
        const requestId = String(doc.requestId || '');
        const id = requestId
          ? createHash('sha256').update(requestId).digest('hex')
          : ref.doc().id;
        const byteCount = Buffer.byteLength(JSON.stringify(doc), 'utf8');
        if (byteCount > 900 * 1024) throw new Error(`ai_api_usage/${id} exceeds the 900 KiB Firestore safety limit`);
        await ref.doc(id).set(doc, { merge: false });
        return { acknowledged: true, insertedId: id };
      },
    };
    recordUsage = createAiApiUsageRecorder(firestoreCollection as never);
    console.log(`[firestore] connected — ${AI_API_USAGE_COLLECTION}`);
    return;
  }
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
