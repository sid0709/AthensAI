import { ObjectId } from 'mongodb';
import {
  jobMatchScoresCollection,
  matchProfileStateCollection,
  jobsCollection,
} from '../../db/mongo.js';
import { enqueueMatchScoreTask } from '../cloudTasks.js';
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
 * This module must stay dependency-light (mongo + shared scorer only) — it is
 * imported from profileSkills.js, so importing profileSkills here would cycle.
 */

export const MIN_STORE_SCORE = (() => {
  const n = Number.parseInt(String(process.env.MATCH_SCORE_MIN_STORE ?? ''), 10);
  return Number.isFinite(n) && n >= 0 ? n : 1;
})();

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

export async function deleteScoresForJobs(jobIds) {
  if (!jobMatchScoresCollection || !jobIds?.length) return { deleted: 0 };
  const ids = jobIds
    .map((id) => {
      if (id instanceof ObjectId) return id;
      try { return new ObjectId(String(id)); } catch { return null; }
    })
    .filter(Boolean);
  if (!ids.length) return { deleted: 0 };
  const res = await jobMatchScoresCollection.deleteMany({ jobId: { $in: ids } });
  return { deleted: res.deletedCount };
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
  await enqueueMatchScoreTask(`${name}-${state?.profileVersion || Date.now()}`);
  return state;
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
      if (id instanceof ObjectId) return id;
      try { return new ObjectId(String(id)); } catch { return null; }
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
