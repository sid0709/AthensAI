import { DocumentId } from '@nextoffer/shared/document-id';
import crypto from 'node:crypto';
import {
  jobMatchScoresCollection,
  matchProfileStateCollection,
  jobsCollection,
} from '../../db/dataStore.js';
import { getRedis, isRedisReady } from '../../db/redis.js';
import { enqueueMatchScoreTask } from '../cloudTasks.js';
import { mapPool } from '../../utils/concurrency.js';
import { enrichJobSkillsFromTitle } from './jobSkillExtraction.js';
import { computeCoverageScore } from './coverageScore.js';

/**
 * Materialized per-user job match scores (fan-out on write).
 *
 * One row per (applierName, jobId) with score >= MIN_STORE_SCORE. Rows are
 * written by the match-score worker (full user rescores + new-job fan-out) and
 * read by the recommended-sort list path as a pure index scan. Rows carry the
 * profileVersion they were computed against; after a full rescore, rows still
 * stamped with an older version are stale (job deleted or dropped below the
 * threshold) and get swept by deleteStaleScores.
 *
 * This module must stay dependency-light (data adapter + shared scorer only) — it is
 * imported from profileSkills.js, so importing profileSkills here would cycle.
 */

export const MIN_STORE_SCORE = (() => {
  const n = Number.parseInt(String(process.env.MATCH_SCORE_MIN_STORE ?? ''), 10);
  return Number.isFinite(n) && n >= 0 ? n : 1;
})();

function profileVersionKey(applierName) {
  const owner = crypto.createHash('sha256').update(String(applierName || '')).digest('hex').slice(0, 20);
  return `ranking:v2:profile-version:${owner}`;
}

async function cacheProfileVersion(applierName, version) {
  if (isRedisReady() && Number.isFinite(Number(version))) {
    await getRedis().set(profileVersionKey(applierName), String(version));
  }
}

/**
 * Score one job against a profile context — the single scorer every writer uses.
 * Prefers AI skills (name + category + requirement) for requirement-weighted
 * coverage; falls back to title-derived strings for a not-yet-extracted job.
 */
export function scoreJobForProfile(job, profileCtx) {
  const jobSkills = Array.isArray(job.aiSkills) && job.aiSkills.length
    ? job.aiSkills
    : enrichJobSkillsFromTitle(job).skills;
  const coverage = computeCoverageScore(jobSkills, profileCtx);
  return {
    score: coverage.matchScore,
    covered: coverage.covered.length,
    required: coverage.required,
  };
}

export function buildScoreRow(applierName, job, result, profileVersion) {
  return {
    applierName,
    jobId: job._id,
    score: result.score,
    covered: result.covered,
    required: result.required,
    profileVersion,
    postedAt: job.postedAt || job._createdAt || null,
    source: job.source || null,
    updatedAt: new Date().toISOString(),
  };
}

export function upsertOpForRow(row) {
  return {
    updateOne: {
      filter: { applierName: row.applierName, jobId: row.jobId },
      update: { $set: row },
      upsert: true,
    },
  };
}

export async function bulkWriteScores(ops) {
  if (!jobMatchScoresCollection || !ops.length) return { written: 0 };
  await jobMatchScoresCollection.bulkWrite(ops, { ordered: false });
  return { written: ops.length };
}

export async function deleteScoreRowsForJobIds({ collection, jobIds, concurrency = 4 }) {
  if (!collection || !jobIds?.length) return { deleted: 0 };
  const normalizedIds = jobIds
    .map((id) => {
      if (id instanceof DocumentId) return id;
      try { return new DocumentId(String(id)); } catch { return null; }
    })
    .filter(Boolean);
  const ids = [...new Map(normalizedIds.map((id) => [String(id), id])).values()];
  if (!ids.length) return { deleted: 0 };

  // Firestore accepts at most 30 values in an `in` query. Sending a larger
  // array makes the compatibility adapter fall back to scanning every score
  // document, which made review-page deletion disproportionately slow.
  const batches = [];
  for (let offset = 0; offset < ids.length; offset += 30) batches.push(ids.slice(offset, offset + 30));
  const results = await mapPool(
    batches,
    Math.max(1, Math.min(8, Number(concurrency) || 4)),
    (batch) => collection.deleteMany({ jobId: { $in: batch } }),
  );
  return { deleted: results.reduce((total, result) => total + Number(result?.deletedCount || 0), 0) };
}

export async function deleteScoresForJobs(jobIds) {
  return deleteScoreRowsForJobIds({
    collection: jobMatchScoresCollection,
    jobIds,
    concurrency: Number(process.env.MATCH_SCORE_DELETE_CONCURRENCY) || 4,
  });
}

export async function deleteScoresForApplier(applierName) {
  if (!jobMatchScoresCollection) return { deleted: 0 };
  const res = await jobMatchScoresCollection.deleteMany({ applierName });
  return { deleted: res.deletedCount };
}

/** Sweep rows not restamped by the rescore that just completed. */
export async function deleteStaleScores(applierName, profileVersion) {
  if (!jobMatchScoresCollection) return { deleted: 0 };
  const res = await jobMatchScoresCollection.deleteMany({
    applierName,
    profileVersion: { $lt: profileVersion },
  });
  return { deleted: res.deletedCount };
}

export async function countScoresForApplier(applierName, extraFilter = {}) {
  if (!jobMatchScoresCollection) return 0;
  return jobMatchScoresCollection.countDocuments({ applierName, ...extraFilter });
}

/**
 * Mark a user's materialized scores as needing a full rebuild. Bumps
 * profileVersion so an in-flight rescore for an older version re-queues itself
 * instead of finishing as current.
 */
export async function requestUserRescore(applierName) {
  const name = String(applierName || '').trim();
  if (!name || !matchProfileStateCollection) return null;
  const state = await matchProfileStateCollection.findOneAndUpdate(
    { applierName: name },
    {
      $inc: { profileVersion: 1 },
      $set: { status: 'pending', requestedAt: new Date().toISOString(), error: null },
    },
    { upsert: true, returnDocument: 'after' },
  );
  await cacheProfileVersion(name, state?.profileVersion ?? 0);
  await enqueueMatchScoreTask(`${name}-${state?.profileVersion || Date.now()}`);
  return state;
}

/** Bump the query-time ranking version without scheduling an O(users x jobs) rebuild. */
export async function bumpProfileRankingVersion(applierName) {
  const name = String(applierName || '').trim();
  if (!name || !matchProfileStateCollection) return null;
  const state = await matchProfileStateCollection.findOneAndUpdate(
    { applierName: name },
    {
      $inc: { profileVersion: 1 },
      $set: { status: 'idle', requestedAt: new Date().toISOString(), error: null },
    },
    { upsert: true, returnDocument: 'after' },
  );
  await cacheProfileVersion(name, state?.profileVersion ?? 0);
  return state;
}

export async function getProfileRankingVersion(applierName) {
  const name = String(applierName || '').trim();
  if (!name) return 0;
  if (isRedisReady()) {
    const cached = await getRedis().get(profileVersionKey(name));
    if (cached != null && Number.isFinite(Number(cached))) return Number(cached);
  }
  const state = await getRescoreState(name);
  const version = Number(state?.profileVersion) || 0;
  await cacheProfileVersion(name, version);
  return version;
}

export async function getRescoreState(applierName) {
  const name = String(applierName || '').trim();
  if (!name || !matchProfileStateCollection) return null;
  return matchProfileStateCollection.findOne({ applierName: name });
}

export async function markJobsPendingScore(jobIds) {
  if (!jobsCollection || !jobIds?.length) return { updated: 0 };
  const ids = jobIds
    .map((id) => {
      if (id instanceof DocumentId) return id;
      try { return new DocumentId(String(id)); } catch { return null; }
    })
    .filter(Boolean);
  if (!ids.length) return { updated: 0 };
  const res = await jobsCollection.updateMany(
    { _id: { $in: ids } },
    { $set: { matchScoreStatus: 'pending' } },
  );
  await enqueueMatchScoreTask(`jobs-${Date.now()}`);
  return { updated: res.modifiedCount };
}
