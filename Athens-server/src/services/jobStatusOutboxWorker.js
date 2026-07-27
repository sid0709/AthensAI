import { getFirestoreDb } from './firebase/firebaseAdmin.js';
import { isRedisReady } from '../db/redis.js';
import { publishStatusCache } from './jobStatusProjectionService.js';
import { incrementCounter, observeHistogram, setGauge } from './monitoring/metrics.js';

const LEASE_MS = 30_000;
let timer = null;
let running = false;
let stopped = true;
const localInflight = new Set();

async function claimRecord(ref) {
  const db = getFirestoreDb();
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return null;
    const row = snapshot.data();
    const leaseTime = row.leaseExpiresAt?.toDate?.()?.getTime?.() ?? (Date.parse(row.leaseExpiresAt || 0) || 0);
    if (row.status === 'completed') return null;
    if (row.status === 'processing' && leaseTime > Date.now()) return null;
    if (row.status !== 'pending' && row.status !== 'processing') return null;
    const now = new Date();
    transaction.update(ref, {
      status: 'processing',
      lastAttemptAt: now,
      leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
      attempts: Number(row.attempts || 0) + 1,
      updatedAt: now,
    });
    return { id: snapshot.id, ...row };
  });
}

export async function processJobStatusOutboxRecord(outboxId) {
  const id = String(outboxId || '').trim();
  if (!id || localInflight.has(id)) return false;
  localInflight.add(id);
  const ref = getFirestoreDb().collection('job_status_outbox').doc(id);
  try {
    const row = await claimRecord(ref);
    if (!row) return false;
    if (!isRedisReady()) throw new Error('Redis is unavailable');
    const createdAtMs = row.createdAt?.toDate?.()?.getTime?.() ?? (Date.parse(row.createdAt || 0) || Date.now());
    const lagSeconds = Math.max(0, (Date.now() - createdAtMs) / 1000);
    setGauge('athens_job_status_outbox_lag_seconds', {}, lagSeconds);
    await publishStatusCache(row.profileId, row.jobId, row.profileStatuses || [], {
      previousStatuses: row.previousStatuses || [],
      extensionV2: Boolean(row.extensionV2),
      adjustCounts: false,
      updateStatusIds: true,
    });
    const completedAt = new Date();
    await ref.update({
      status: 'completed',
      completedAt,
      updatedAt: completedAt,
      leaseExpiresAt: null,
      error: null,
      expiresAt: new Date(completedAt.getTime() + 7 * 24 * 60 * 60 * 1000),
    });
    incrementCounter('athens_job_status_outbox_total', { result: 'completed' });
    observeHistogram('athens_job_status_cache_publication_seconds', {}, Math.max(0, (Date.now() - createdAtMs) / 1000));
    return true;
  } catch (error) {
    incrementCounter('athens_job_status_outbox_total', { result: 'retry' });
    await ref.update({
      status: 'pending',
      updatedAt: new Date(),
      leaseExpiresAt: null,
      error: String(error?.message || error).slice(0, 1000),
    }).catch(() => undefined);
    throw error;
  } finally {
    localInflight.delete(id);
  }
}

async function pendingRecords(limit) {
  const db = getFirestoreDb();
  const pending = await db.collection('job_status_outbox')
    .where('status', '==', 'pending')
    .limit(limit)
    .get();
  const expiredProcessing = await db.collection('job_status_outbox')
    .where('status', '==', 'processing')
    .limit(limit)
    .get();
  const now = Date.now();
  return [
    ...pending.docs,
    ...expiredProcessing.docs.filter((doc) => {
      const raw = doc.data()?.leaseExpiresAt;
      const expiresAt = raw?.toDate?.()?.getTime?.() ?? (Date.parse(raw || 0) || 0);
      return expiresAt <= now;
    }),
  ].slice(0, limit);
}

async function runOnce() {
  if (running || stopped) return;
  running = true;
  try {
    const limit = Math.max(1, Number(process.env.JOB_STATUS_OUTBOX_BATCH_SIZE || 100));
    const docs = await pendingRecords(limit);
    for (const doc of docs) {
      if (stopped) break;
      await processJobStatusOutboxRecord(doc.id).catch((error) => {
        console.warn('[job-status-outbox] publication failed; will retry:', error?.message || error);
      });
    }
  } catch (error) {
    console.error('[job-status-outbox] worker pass failed:', error?.message || error);
  } finally {
    running = false;
  }
}

export function startJobStatusOutboxWorker() {
  if (timer) return;
  stopped = false;
  const intervalMs = Math.max(1_000, Number(process.env.JOB_STATUS_OUTBOX_INTERVAL_MS || 5_000));
  timer = setInterval(() => void runOnce(), intervalMs);
  timer.unref?.();
  void runOnce();
  console.log(`[job-status-outbox] worker started (interval=${intervalMs}ms)`);
}

export function stopJobStatusOutboxWorker() {
  stopped = true;
  if (timer) clearInterval(timer);
  timer = null;
}

export const jobStatusOutboxWorkerTest = { claimRecord, pendingRecords, runOnce };
