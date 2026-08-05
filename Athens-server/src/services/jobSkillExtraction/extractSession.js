/**
 * Manual, concurrency-limited AI skill-extraction session with immediate Stop.
 * Triggered from the Job Search "Extract skills" button. Processes job_market only
 * (external_scraped_jobs is dedupe/provenance; jobs are promoted into job_market).
 */
import { randomUUID } from 'crypto';
import { excludeExtensionV2JobsFilter } from '../../config/jobMarketSchema.js';
import { jobsCollection } from '../../db/dataStore.js';
import { isBetaTier } from '../../lib/betaTier.js';
import { getFirestoreDb } from '../firebase/firebaseAdmin.js';
import { formatCostUsd } from '../llm/llmService.js';
import { findAccountByApplierName } from '../mail/credentials.js';
import {
  resolveExtractionAuth,
  extractAndPersistJobBatch,
  recordExtractionFailure,
  SKILL_EXTRACT_BATCH_SIZE,
} from './aiExtractService.js';
import { firestoreMutationLimiter } from '../backgroundTasks/resourceLimits.js';
import { runWithoutBackgroundTaskContext } from '../backgroundTasks/taskContext.js';

function positiveEnv(name, fallback, minimum = 1) {
  const value = Number(process.env[name]);
  return Math.floor(Number.isFinite(value) && value >= minimum ? value : fallback);
}

const BATCH_CONCURRENCY = positiveEnv('JOB_SKILL_EXTRACT_BATCH_CONCURRENCY', 8);
const JOBS_PER_WAVE = BATCH_CONCURRENCY * SKILL_EXTRACT_BATCH_SIZE;
const STALE_CLAIM_MS = positiveEnv('JOB_SKILL_EXTRACT_STALE_CLAIM_MS', 15 * 60_000, 60_000);
const RECOVERY_CONCURRENCY = positiveEnv('JOB_SKILL_EXTRACT_RECOVERY_CONCURRENCY', 20);
const CLAIM_CONCURRENCY = positiveEnv('JOB_SKILL_EXTRACT_CLAIM_CONCURRENCY', 8);

const MARKET_CLAIM_PROJECTION = { title: 1, description: 1, jobDescription: 1, aiSkillAttempts: 1 };

const pendingCountCache = new Map();
let pendingCountGeneration = 0;
const pendingCountRefreshedGeneration = new Map([['all', 0], ['public', 0]]);
const PENDING_COUNT_CACHE_MS = Math.max(
  5_000,
  Number(process.env.JOB_SKILL_PENDING_COUNT_CACHE_MS || 30_000),
);

export function pendingExtractionQuery(includeV2) {
  // Failed extractions are globally retriable — once extracted, every user benefits.
  const status = { aiSkillStatus: { $in: ['pending', 'failed'] } };
  if (includeV2) return status;
  return { ...status, ...excludeExtensionV2JobsFilter() };
}

async function countPendingInCollection(collection, includeV2) {
  if (!collection) return 0;
  try {
    let query = getFirestoreDb()
      .collection('jobs')
      .where('sourceCatalog', '==', 'market')
      .where('aiSkillStatus', 'in', ['pending', 'failed']);
    if (!includeV2) query = query.where('extensionV2', '==', false);
    return (await query.count().get()).data().count;
  } catch (error) {
    if (Number(error?.code) !== 9) throw error;
    // Keep the badge functional while a declared Firestore index is building.
    return collection
      .find(pendingExtractionQuery(includeV2), { projection: { _id: 1 } })
      .toArray()
      .then((jobs) => jobs.length);
  }
}

export async function countPendingExtraction(includeV2 = true) {
  return countPendingInCollection(jobsCollection, includeV2);
}

export async function countPendingExtractionBreakdown(includeV2 = true) {
  const pendingMarket = await countPendingInCollection(jobsCollection, includeV2);
  return { pending: pendingMarket, pendingMarket, pendingExternal: 0 };
}

async function countPendingExtractionCached(includeV2) {
  const key = includeV2 ? 'all' : 'public';
  const generation = pendingCountGeneration;
  const cached = pendingCountCache.get(key);
  if (cached?.expiresAt > Date.now()) return cached.promise;
  const promise = countPendingExtraction(includeV2)
    .catch((error) => {
      pendingCountCache.delete(key);
      throw error;
    })
    .then((count) => {
      if (pendingCountGeneration !== generation) {
        pendingCountCache.delete(key);
        return count;
      }
      pendingCountRefreshedGeneration.set(key, generation);
      return count;
    });
  pendingCountCache.set(key, {
    promise,
    expiresAt: Date.now() + PENDING_COUNT_CACHE_MS,
  });
  return promise;
}

export function invalidatePendingExtractionCount() {
  pendingCountGeneration += 1;
  pendingCountCache.clear();
}

async function includeV2JobsForApplier(applierName) {
  const name = String(applierName || '').trim();
  if (!name) return false;
  const account = await findAccountByApplierName(name);
  return isBetaTier(account?.tier);
}

function throwIfCancelled(signal) {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : Object.assign(new Error('Skill extraction cancelled'), { name: 'AbortError' });
}

export async function claimPendingJobs(collection, jobs, {
  catalog = 'market',
  sessionId,
  claimedAt,
  signal,
} = {}) {
  throwIfCancelled(signal);
  const timestamp = claimedAt || new Date().toISOString();
  const claimUpdate = {
    $set: {
      aiSkillStatus: 'extracting',
      aiSkillClaimedAt: timestamp,
      aiSkillSessionId: sessionId,
    },
  };
  if (typeof collection.atomicClaimMany === 'function') {
    const claimedIds = new Set(await firestoreMutationLimiter.run(async () => {
      throwIfCancelled(signal);
      return collection.atomicClaimMany(
        jobs.map((job) => job._id),
        { aiSkillStatus: { $in: ['pending', 'failed'] } },
        claimUpdate,
      );
    }));
    return jobs
      .filter((job) => claimedIds.has(String(job._id)))
      .map((job) => ({ ...job, catalog, title: job.title }));
  }
  const claimed = new Array(jobs.length).fill(null);
  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const index = next++;
      const job = jobs[index];
      throwIfCancelled(signal);
      const result = await firestoreMutationLimiter.run(async () => {
        throwIfCancelled(signal);
        return collection.updateOne(
          { _id: job._id, aiSkillStatus: { $in: ['pending', 'failed'] } },
          claimUpdate,
        );
      });
      if (Number(result?.modifiedCount) === 1) {
        claimed[index] = { ...job, catalog, title: job.title };
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CLAIM_CONCURRENCY, jobs.length) }, () => worker()),
  );
  return claimed.filter(Boolean);
}

async function claimFromCollection(collection, catalog, projection, n, includeV2, sessionId, signal) {
  if (!collection || n <= 0) return [];
  throwIfCancelled(signal);
  const query = pendingExtractionQuery(includeV2);
  // Ordering pending work is not user-visible and would force Firestore to
  // scan an ever-growing prefix of already-extracted jobs. Read directly from
  // the aiSkillStatus index and modestly overfetch for the local tier filter.
  const jobs = await collection
    .find(query)
    .project(projection)
    .limit(n * 4)
    .toArray();
  throwIfCancelled(signal);
  if (!jobs.length) return [];

  return claimPendingJobs(collection, jobs.slice(0, n), { catalog, sessionId, signal });
}

async function claimBatch(n, includeV2, sessionId, signal) {
  return claimFromCollection(
    jobsCollection,
    'market',
    MARKET_CLAIM_PROJECTION,
    n,
    includeV2,
    sessionId,
    signal,
  );
}

async function requeueJobs(jobs, sessionId) {
  if (!jobsCollection || !jobs.length) return;
	await runWithoutBackgroundTaskContext(() => firestoreMutationLimiter.run(() =>
		jobsCollection.bulkWrite(
			jobs.map((job) => ({
				updateOne: {
					filter: { _id: job._id, aiSkillSessionId: sessionId },
					update: {
						$set: { aiSkillStatus: 'pending' },
						$unset: { aiSkillClaimedAt: '', aiSkillSessionId: '' },
					},
				},
			})),
			{ ordered: false },
		))).catch(() => {});
}

function extractionCancellationRequested(signal) {
  return signal?.aborted === true;
}

function extractionTaskSnapshot(session) {
  return {
    running: session.running,
    status: session.status,
    sessionId: session.id,
    total: session.total,
    processed: session.processed,
    extracted: session.extracted,
    failed: session.failed,
    retried: session.retried || 0,
    remaining: session.remaining,
    pendingMarket: session.pendingMarket ?? null,
    pendingExternal: session.pendingExternal ?? null,
    lastJob: session.lastJob ?? null,
    startedAt: session.startedAt,
    finishedAt: session.finishedAt ?? null,
    error: session.error ?? null,
    phase: session.phase ?? null,
    inflight: session.inflight || 0,
    cancelled: session.cancelled || 0,
    lastProgressAt: session.lastProgressAt ?? null,
    concurrency: BATCH_CONCURRENCY,
    batchSize: SKILL_EXTRACT_BATCH_SIZE,
    jobsPerWave: JOBS_PER_WAVE,
    provider: session.provider ?? null,
    model: session.model ?? null,
    inputTokens: session.inputTokens,
    outputTokens: session.outputTokens,
    costUsd: session.costUsd,
  };
}

async function processBatch(session, auth, jobs, { signal, onProgress } = {}) {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(signal?.reason);
  if (signal?.aborted) abortFromParent();
  else signal?.addEventListener('abort', abortFromParent, { once: true });
  session.inflight += jobs.length;
  session.phase = 'extracting';
  try {
    const result = await extractAndPersistJobBatch(jobs, auth, {
      signal: controller.signal,
    });
    session.extracted += result.results.length;
    const lastResult = result.results[result.results.length - 1];
    const lastJob = lastResult
      ? jobs.find((job) => String(job._id) === lastResult.jobId)
      : null;
    session.lastJob = {
      id: lastResult?.jobId || String(jobs[jobs.length - 1]?._id || ''),
      title: lastJob?.title || jobs[jobs.length - 1]?.title || '',
      skills: lastResult?.skillCount || 0,
      catalog: 'market',
      batchSize: jobs.length,
    };
    if (result.usage) {
      session.inputTokens += result.usage.inputTokens || 0;
      session.outputTokens += result.usage.outputTokens || 0;
      if (typeof result.usage.cost === 'number') session.costUsd += result.usage.cost;
    }
  } catch (err) {
    if (extractionCancellationRequested(signal) || controller.signal.aborted) {
      await requeueJobs(jobs, session.id);
      session.cancelled += jobs.length;
      return;
    }
    const failures = await Promise.all(
      jobs.map((job) => recordExtractionFailure(job, err, { catalog: 'market' })),
    );
    session.failed += failures.filter((failure) => failure?.terminal).length;
    session.retried += failures.filter((failure) => failure && !failure.terminal).length;
    console.error(`[job-skill-extract] batch failed (${jobs.length} jobs): ${err.message}`);
  } finally {
    signal?.removeEventListener('abort', abortFromParent);
    session.inflight = Math.max(0, session.inflight - jobs.length);
    session.processed += jobs.length;
    session.remaining = session.total == null
      ? null
      : Math.max(0, session.total - session.processed);
    session.lastProgressAt = new Date().toISOString();
    await onProgress?.(extractionTaskSnapshot(session));
  }
}

function chunkJobs(jobs, size) {
  const chunks = [];
  for (let offset = 0; offset < jobs.length; offset += size) {
    chunks.push(jobs.slice(offset, offset + size));
  }
  return chunks;
}

async function recoverStuckExtracting(signal) {
  if (!jobsCollection) return 0;
  throwIfCancelled(signal);
  const staleBeforeMs = Date.now() - STALE_CLAIM_MS;
  const stuck = await jobsCollection
    // Keep this as a single-field indexed query. The claimedAt stale check is
    // deliberately local so recovery never depends on a Firestore composite
    // index or falls back to scanning the whole job catalog.
    .find({ aiSkillStatus: 'extracting' })
    .project({ _id: 1, aiSkillClaimedAt: 1 })
    .toArray()
    .then((rows) => rows.filter((job) => {
      if (!job.aiSkillClaimedAt) return true;
      const claimedAtMs = new Date(job.aiSkillClaimedAt).getTime();
      return !Number.isFinite(claimedAtMs) || claimedAtMs < staleBeforeMs;
    }))
    .catch(() => []);
  throwIfCancelled(signal);
  let next = 0;
  async function worker() {
    while (next < stuck.length) {
      const job = stuck[next++];
      throwIfCancelled(signal);
      await firestoreMutationLimiter.run(async () => {
        throwIfCancelled(signal);
        return jobsCollection.updateOne(
          { _id: job._id, aiSkillStatus: 'extracting' },
          {
            $set: { aiSkillStatus: 'pending' },
            $unset: { aiSkillClaimedAt: '', aiSkillSessionId: '' },
          },
        );
      }).catch((error) => {
        if (signal?.aborted || error?.name === 'AbortError') throw error;
      });
    }
  }
  await Promise.all(Array.from({ length: Math.min(RECOVERY_CONCURRENCY, stuck.length) }, () => worker()));
  return stuck.length;
}

async function releaseSessionClaims(sessionId) {
  if (!jobsCollection || !sessionId) return 0;
  const claimed = await jobsCollection.find({
    aiSkillStatus: 'extracting',
    aiSkillSessionId: sessionId,
  }, { projection: { _id: 1 } }).limit(2_000).toArray();
  if (!claimed.length) return 0;
	const result = await firestoreMutationLimiter.run(() => jobsCollection.bulkWrite(claimed.map((job) => ({
    updateOne: {
      filter: { _id: job._id, aiSkillSessionId: sessionId },
      update: {
        $set: { aiSkillStatus: 'pending' },
        $unset: { aiSkillClaimedAt: '', aiSkillSessionId: '' },
      },
    },
	})), { ordered: false }));
  return result.modifiedCount || 0;
}

export async function releaseSkillExtractionTaskClaims(taskId) {
  const released = await releaseSessionClaims(String(taskId || ''));
  if (released) invalidatePendingExtractionCount();
  return released;
}

async function runSession(session, auth, { signal, onProgress } = {}) {
  session.provider = auth.providerId;
  session.model = auth.model;
  console.log(
    `[job-skill-extract] starting — ${auth.providerId}/${auth.model}, ` +
      `${BATCH_CONCURRENCY}× batches of ≤${SKILL_EXTRACT_BATCH_SIZE}, ` +
      `${session.total == null ? 'until the queue is empty' : `${session.total} job(s)`}`,
  );

  try {
    session.phase = 'recovering';
    await onProgress?.(extractionTaskSnapshot(session));
    await recoverStuckExtracting(signal);
    while (!extractionCancellationRequested(signal)) {
      session.phase = 'claiming';
      await onProgress?.(extractionTaskSnapshot(session));
      let take = JOBS_PER_WAVE;
      if (session.limit != null) {
        take = Math.min(take, session.limit - session.processed);
        if (take <= 0) break;
      }
      const batch = await claimBatch(take, session.includeV2Jobs !== false, session.id, signal);
      if (!batch.length) break;
      await Promise.all(
        chunkJobs(batch, SKILL_EXTRACT_BATCH_SIZE).map((jobs) => processBatch(session, auth, jobs, { signal, onProgress })),
      );
    }
  } finally {
    session.running = false;
    session.finishedAt = new Date().toISOString();
    session.status = extractionCancellationRequested(signal) ? 'cancelled' : 'completed';
    session.phase = session.status;
    if (!extractionCancellationRequested(signal)) {
      session.total = session.processed;
      session.remaining = 0;
    } else {
      session.remaining = null;
    }
    invalidatePendingExtractionCount();
    await onProgress?.(extractionTaskSnapshot(session));
    console.log(
      `[job-skill-extract] ${session.status} — ${session.extracted} extracted, ${session.failed} failed · ` +
        `${session.inputTokens + session.outputTokens} tokens · ${formatCostUsd(session.costUsd)}`,
    );
  }
}

/** Worker-owned runner. It has no dependency on HTTP-process-local session state. */
export async function runSkillExtractionTask({
  taskId,
  applierName,
  profileId,
  limit = null,
  signal,
  onProgress,
} = {}) {
  if (!jobsCollection) throw new Error('Database not ready');
  const name = String(applierName || '').trim();
  if (!name) throw new Error('applierName is required.');
  const auth = await resolveExtractionAuth(name, { profileId });
  const includeV2Jobs = await includeV2JobsForApplier(name);
  const parsedLimit = limit != null ? Math.max(1, Math.floor(Number(limit) || 1)) : null;
  const id = String(taskId || randomUUID());
  await releaseSessionClaims(id);
  const session = {
    id,
    applierName: name,
    includeV2Jobs,
    running: true,
    status: 'running',
    total: parsedLimit,
    limit: parsedLimit,
    processed: 0,
    extracted: 0,
    failed: 0,
    retried: 0,
    cancelled: 0,
    remaining: parsedLimit,
    pendingMarket: null,
    pendingExternal: null,
    lastJob: null,
    phase: 'starting',
    inflight: 0,
    lastProgressAt: null,
    provider: auth.providerId,
    model: auth.model,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
  };
  await onProgress?.(extractionTaskSnapshot(session));
  await runSession(session, auth, { signal, onProgress });
  return extractionTaskSnapshot(session);
}
