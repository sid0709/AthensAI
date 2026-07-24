import {
  jobsCollection,
  accountInfoCollection,
  matchProfileStateCollection,
} from '../../db/mongo.js';
import { loadProfileMatchContext, clearProfileSkillCache } from './profileSkills.js';
import {
  MIN_STORE_SCORE,
  scoreJobForProfile,
  buildScoreRow,
  upsertOpForRow,
  bulkWriteScores,
  deleteScoresForApplier,
  deleteStaleScores,
} from './matchScoreStore.js';

/**
 * Background worker keeping job_match_scores current (mirrors the
 * jobAnalysis worker pattern). Two duties, rescores first:
 *
 * 1. User rescore — a profile changed: recompute that user's score for every
 *    job. Streams job projections (never full docs), bulk-upserts rows stamped
 *    with the claimed profileVersion, then sweeps rows the pass didn't restamp.
 * 2. Job fan-out — new/re-analyzed jobs (matchScoreStatus: 'pending'): score
 *    each against every user profile in one pass.
 *
 * Scores job_market only (external scrapes are promoted into job_market).
 */

const WORKER_INTERVAL_MS = Number(process.env.MATCH_SCORE_WORKER_INTERVAL_MS || 3000);
const JOB_BATCH = Number(process.env.MATCH_SCORE_JOB_BATCH || 200);
const RESCORE_WRITE_BATCH = 1000;

const JOB_SCORE_PROJECTION = { title: 1, skills: 1, aiSkills: 1, postedAt: 1, _createdAt: 1, source: 1 };

function scoreAndQueueJob(job, applierName, ctx, profileVersion, ops) {
  const result = scoreJobForProfile(job, ctx);
  if (result.score >= MIN_STORE_SCORE) {
    ops.push(upsertOpForRow(buildScoreRow(applierName, job, result, profileVersion)));
  } else {
    ops.push({ deleteOne: { filter: { applierName, jobId: job._id } } });
  }
}

function hasProfileSignal(ctx) {
  return Boolean(
    ctx?.profileTokens?.length || ctx?.profileCompacts?.length || ctx?.exactSet?.size,
  );
}

/** Full rebuild of one user's rows. Exported so the backfill script can run it inline. */
export async function rescoreUser(state) {
  const { applierName, profileVersion } = state;
  const startedAt = Date.now();

  // Fresh context — the cached one may predate the profile change.
  await clearProfileSkillCache(applierName);
  const ctx = await loadProfileMatchContext(applierName);

  if (!hasProfileSignal(ctx)) {
    const { deleted } = await deleteScoresForApplier(applierName);
    await matchProfileStateCollection.updateOne(
      { applierName, profileVersion, status: 'running' },
      {
        $set: {
          status: 'idle',
          completedAt: new Date().toISOString(),
          lastDurationMs: Date.now() - startedAt,
          lastRowCount: 0,
        },
      },
    );
    return { rows: 0, cleared: deleted };
  }

  let rows = 0;
  let ops = [];
  const cursor = jobsCollection.find({}).project(JOB_SCORE_PROJECTION);
  for await (const job of cursor) {
    const result = scoreJobForProfile(job, ctx);
    if (result.score < MIN_STORE_SCORE) continue;
    ops.push(upsertOpForRow(buildScoreRow(applierName, job, result, profileVersion)));
    if (ops.length >= RESCORE_WRITE_BATCH) {
      await bulkWriteScores(ops);
      rows += ops.length;
      ops = [];
    }
  }
  await bulkWriteScores(ops);
  rows += ops.length;

  // Rows still on an older version were not restamped: the job was deleted or
  // fell below the store threshold under the new profile.
  await deleteStaleScores(applierName, profileVersion);

  // Only finish if no newer rescore was requested mid-run; otherwise the state
  // doc is already back to pending with a bumped version and reruns next tick.
  const finished = await matchProfileStateCollection.updateOne(
    { applierName, profileVersion, status: 'running' },
    {
      $set: {
        status: 'idle',
        completedAt: new Date().toISOString(),
        lastDurationMs: Date.now() - startedAt,
        lastRowCount: rows,
      },
    },
  );
  return { rows, requeued: finished.modifiedCount === 0 };
}

async function claimAndRescoreUser() {
  if (!matchProfileStateCollection || !jobsCollection) return false;
  const state = await matchProfileStateCollection.findOneAndUpdate(
    { status: 'pending' },
    { $set: { status: 'running', startedAt: new Date().toISOString() } },
    { sort: { requestedAt: 1 }, returnDocument: 'after' },
  );
  if (!state) return false;

  try {
    const result = await rescoreUser(state);
    console.log(
      `[match-score] rescored ${state.applierName}: ${result.rows ?? 0} row(s)` +
        (result.requeued ? ' (superseded mid-run, requeued)' : ''),
    );
  } catch (err) {
    console.error(`[match-score] rescore failed for ${state.applierName}`, err.message);
    await matchProfileStateCollection.updateOne(
      { applierName: state.applierName, status: 'running' },
      { $set: { status: 'pending', error: String(err?.message || err).slice(0, 500) } },
    );
  }
  return true;
}

async function loadAllProfileContexts() {
  const accounts = await accountInfoCollection
    .find({}, { projection: { name: 1 } })
    .toArray();
  const contexts = new Map();
  const states = new Map();
  const stateDocs = await matchProfileStateCollection.find({}).toArray();
  for (const s of stateDocs) states.set(s.applierName, s.profileVersion ?? 0);

  for (const acc of accounts) {
    const name = String(acc.name || '').trim();
    if (!name || contexts.has(name)) continue;
    try {
      const ctx = await loadProfileMatchContext(name);
      if (hasProfileSignal(ctx)) {
        contexts.set(name, { ctx, profileVersion: states.get(name) ?? 0 });
      }
    } catch (err) {
      console.warn(`[match-score] profile load failed for ${name}`, err.message);
    }
  }
  return contexts;
}

async function fanOutPendingJobs() {
  if (!jobsCollection) return false;

  const marketJobs = await jobsCollection
    .find({ matchScoreStatus: 'pending' })
    .project(JOB_SCORE_PROJECTION)
    .sort({ postedAt: -1 })
    .limit(JOB_BATCH)
    .toArray();

  if (!marketJobs.length) return false;

  const contexts = await loadAllProfileContexts();
  const ops = [];

  for (const job of marketJobs) {
    for (const [name, { ctx, profileVersion }] of contexts) {
      scoreAndQueueJob(job, name, ctx, profileVersion, ops);
    }
  }

  for (let i = 0; i < ops.length; i += RESCORE_WRITE_BATCH) {
    await bulkWriteScores(ops.slice(i, i + RESCORE_WRITE_BATCH));
  }

  const now = new Date().toISOString();
  await jobsCollection.updateMany(
    { _id: { $in: marketJobs.map((j) => j._id) } },
    { $set: { matchScoreStatus: 'scored', matchScoredAt: now } },
  );

  console.log(
    `[match-score] fanned out ${marketJobs.length} market job(s) × ${contexts.size} profile(s)`,
  );
  return true;
}

export async function runMatchScoreBatch() {
	const rescored = await claimAndRescoreUser();
	const fannedOut = rescored ? false : await fanOutPendingJobs();
	return { processed: Boolean(rescored || fannedOut), rescored, fannedOut };
}

let workerTimer = null;
let tickRunning = false;

export function startMatchScoreWorker() {
  if (workerTimer) return;

  const tick = async () => {
    if (tickRunning) return; // a full rescore can outlast the interval
    tickRunning = true;
    try {
			await runMatchScoreBatch();
    } catch (err) {
      console.error('[match-score] worker tick error', err.message);
    } finally {
      tickRunning = false;
    }
  };

  workerTimer = setInterval(tick, WORKER_INTERVAL_MS);
  void tick();
  console.log(
    `[match-score] worker started (interval ${WORKER_INTERVAL_MS}ms, job batch ${JOB_BATCH}, min store score ${MIN_STORE_SCORE})`,
  );
}

export function stopMatchScoreWorker() {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
  }
}
