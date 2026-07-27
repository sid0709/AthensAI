/**
 * Manual, concurrency-limited AI skill-extraction session with immediate Stop.
 * Triggered from the Job Search "Extract skills" button. Processes job_market only
 * (external_scraped_jobs is dedupe/provenance; jobs are promoted into job_market).
 */
import { randomUUID } from 'crypto';
import { excludeExtensionV2JobsFilter } from '../../config/jobMarketSchema.js';
import { jobsCollection } from '../../db/mongo.js';
import { formatCostUsd } from '../llm/llmService.js';
import {
  resolveExtractionAuth,
  extractAndPersistJobBatch,
  recordExtractionFailure,
  SKILL_EXTRACT_BATCH_SIZE,
} from './aiExtractService.js';

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

let activeSession = null;
let cancelRequested = false;
const inflight = new Set();

function pendingQuery(includeV2) {
  if (includeV2) return { aiSkillStatus: 'pending' };
  return { aiSkillStatus: 'pending', ...excludeExtensionV2JobsFilter() };
}

async function countPendingInCollection(collection, includeV2) {
  if (!collection) return 0;
  return collection.countDocuments(pendingQuery(includeV2));
}

export async function countPendingExtraction(includeV2 = true) {
  return countPendingInCollection(jobsCollection, includeV2);
}

export async function countPendingExtractionBreakdown(includeV2 = true) {
  const pendingMarket = await countPendingInCollection(jobsCollection, includeV2);
  return { pending: pendingMarket, pendingMarket, pendingExternal: 0 };
}

export async function claimPendingJobs(collection, jobs, { catalog = 'market', sessionId, claimedAt } = {}) {
  const timestamp = claimedAt || new Date().toISOString();
  const claimUpdate = {
    $set: {
      aiSkillStatus: 'extracting',
      aiSkillClaimedAt: timestamp,
      aiSkillSessionId: sessionId,
    },
  };
  if (typeof collection.atomicClaimMany === 'function') {
    const claimedIds = new Set(await collection.atomicClaimMany(
      jobs.map((job) => job._id),
      { aiSkillStatus: 'pending' },
      claimUpdate,
    ));
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
      const result = await collection.updateOne(
        { _id: job._id, aiSkillStatus: 'pending' },
        claimUpdate,
      );
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

async function claimFromCollection(collection, catalog, projection, n, includeV2, sessionId) {
  if (!collection || n <= 0) return [];
  const query = pendingQuery(includeV2);
  // Ordering pending work is not user-visible and would force Firestore to
  // scan an ever-growing prefix of already-extracted jobs. Read directly from
  // the aiSkillStatus index and modestly overfetch for the local tier filter.
  const jobs = await collection
    .find(query)
    .project(projection)
    .limit(n * 4)
    .toArray();
  if (!jobs.length) return [];

  return claimPendingJobs(collection, jobs.slice(0, n), { catalog, sessionId });
}

async function claimBatch(n, includeV2, sessionId) {
  return claimFromCollection(
    jobsCollection,
    'market',
    MARKET_CLAIM_PROJECTION,
    n,
    includeV2,
    sessionId,
  );
}

async function requeueJobs(jobs, sessionId) {
  if (!jobsCollection || !jobs.length) return;
  await jobsCollection.bulkWrite(
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
  ).catch(() => {});
}

async function processBatch(session, auth, jobs) {
  const controller = new AbortController();
  inflight.add(controller);
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
    if (cancelRequested || controller.signal.aborted) {
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
    inflight.delete(controller);
    session.inflight = Math.max(0, session.inflight - jobs.length);
    session.processed += jobs.length;
    session.remaining = session.total == null
      ? null
      : Math.max(0, session.total - session.processed);
    session.lastProgressAt = new Date().toISOString();
  }
}

function chunkJobs(jobs, size) {
  const chunks = [];
  for (let offset = 0; offset < jobs.length; offset += size) {
    chunks.push(jobs.slice(offset, offset + size));
  }
  return chunks;
}

async function recoverStuckExtracting() {
  if (!jobsCollection) return 0;
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
  let next = 0;
  async function worker() {
    while (next < stuck.length) {
      const job = stuck[next++];
      await jobsCollection.updateOne(
        { _id: job._id, aiSkillStatus: 'extracting' },
        {
          $set: { aiSkillStatus: 'pending' },
          $unset: { aiSkillClaimedAt: '', aiSkillSessionId: '' },
        },
      ).catch(() => {});
    }
  }
  await Promise.all(Array.from({ length: Math.min(RECOVERY_CONCURRENCY, stuck.length) }, () => worker()));
  return stuck.length;
}

async function runSession(session, auth) {
  session.provider = auth.providerId;
  session.model = auth.model;
  console.log(
    `[job-skill-extract] starting — ${auth.providerId}/${auth.model}, ` +
      `${BATCH_CONCURRENCY}× batches of ≤${SKILL_EXTRACT_BATCH_SIZE}, ` +
      `${session.total == null ? 'until the queue is empty' : `${session.total} job(s)`}`,
  );

  try {
    session.phase = 'recovering';
    await recoverStuckExtracting();
    while (!cancelRequested) {
      session.phase = 'claiming';
      let take = JOBS_PER_WAVE;
      if (session.limit != null) {
        take = Math.min(take, session.limit - session.processed);
        if (take <= 0) break;
      }
      const batch = await claimBatch(take, session.includeV2Jobs !== false, session.id);
      if (!batch.length) break;
      await Promise.all(
        chunkJobs(batch, SKILL_EXTRACT_BATCH_SIZE).map((jobs) => processBatch(session, auth, jobs)),
      );
    }
  } finally {
    session.running = false;
    session.finishedAt = new Date().toISOString();
    session.status = cancelRequested ? 'cancelled' : 'completed';
    session.phase = session.status;
    if (!cancelRequested) {
      session.total = session.processed;
      session.remaining = 0;
    } else {
      session.remaining = null;
    }
    console.log(
      `[job-skill-extract] ${session.status} — ${session.extracted} extracted, ${session.failed} failed · ` +
        `${session.inputTokens + session.outputTokens} tokens · ${formatCostUsd(session.costUsd)}`,
    );
  }
}

export function getExtractionStatus() {
  if (!activeSession) return { running: false, status: 'idle' };
  return {
    running: activeSession.running,
    status: activeSession.status,
    sessionId: activeSession.id,
    total: activeSession.total,
    processed: activeSession.processed,
    extracted: activeSession.extracted,
    failed: activeSession.failed,
    retried: activeSession.retried || 0,
    remaining: activeSession.remaining,
    pendingMarket: activeSession.pendingMarket ?? null,
    pendingExternal: activeSession.pendingExternal ?? null,
    lastJob: activeSession.lastJob ?? null,
    startedAt: activeSession.startedAt,
    finishedAt: activeSession.finishedAt ?? null,
    error: activeSession.error ?? null,
    phase: activeSession.phase ?? null,
    inflight: activeSession.inflight || 0,
    cancelled: activeSession.cancelled || 0,
    lastProgressAt: activeSession.lastProgressAt ?? null,
    concurrency: BATCH_CONCURRENCY,
    batchSize: SKILL_EXTRACT_BATCH_SIZE,
    jobsPerWave: JOBS_PER_WAVE,
    provider: activeSession.provider ?? null,
    model: activeSession.model ?? null,
    inputTokens: activeSession.inputTokens,
    outputTokens: activeSession.outputTokens,
    costUsd: activeSession.costUsd,
  };
}

export async function getSkillExtractionStatus({ applierName } = {}) {
  if (activeSession?.running) {
    return {
      ...getExtractionStatus(),
      pending: activeSession.remaining,
      pendingKnown: activeSession.remaining != null,
    };
  }
  return { pending: null, pendingKnown: false, ...getExtractionStatus() };
}

export async function startSkillExtractionSession({ applierName, limit = null } = {}) {
  if (!jobsCollection) {
    throw new Error('Database not ready');
  }
  if (activeSession?.running) throw new Error('Skill extraction session already running');

  const auth = await resolveExtractionAuth(applierName);
  const includeV2Jobs = auth.includeV2Jobs === true;
  const parsedLimit = limit != null ? Math.max(1, Math.floor(Number(limit) || 1)) : null;

  cancelRequested = false;
  activeSession = {
    id: randomUUID(),
    applierName: String(applierName || '').trim(),
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
    provider: null,
    model: null,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };

  void runSession(activeSession, auth).catch((err) => {
    console.error('[job-skill-extract] session error', err);
    if (activeSession) {
      activeSession.running = false;
      activeSession.status = 'failed';
      activeSession.error = err.message;
    }
  });

  return {
    sessionId: activeSession.id,
    pending: null,
    pendingKnown: false,
    started: true,
  };
}

export function stopSkillExtractionSession() {
  if (!activeSession?.running) return { stopped: false, message: 'No active session' };
  cancelRequested = true;
  activeSession.status = 'stopping';
  activeSession.phase = 'stopping';
  for (const controller of inflight) controller.abort();
  return { stopped: true, sessionId: activeSession.id };
}
