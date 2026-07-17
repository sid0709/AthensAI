/**
 * Backfill the materialized job_match_scores collection for every account:
 * runs a full rescore per user (same code path as the worker), then marks all
 * jobs 'scored' so the fan-out worker starts with a clean slate.
 *
 * Resumable: each user's completion is recorded in match_profile_state, and
 * re-running only redoes users whose state is still pending/running.
 *
 * Usage: node src/scripts/backfillMatchScores.js [--force]
 *   --force  re-queue every user even if their last rescore completed
 */
import dotenv from 'dotenv';
dotenv.config();

import {
  initMongo,
  closeMongo,
  jobsCollection,
  accountInfoCollection,
  matchProfileStateCollection,
} from '../db/mongo.js';
import { requestUserRescore, countScoresForApplier } from '../services/matching/matchScoreStore.js';
import { rescoreUser } from '../services/matching/matchScoreWorker.js';

const force = process.argv.includes('--force');

async function main() {
  await initMongo();

  if (!jobsCollection || !accountInfoCollection || !matchProfileStateCollection) {
    throw new Error('MongoDB not ready');
  }

  const accounts = await accountInfoCollection
    .find({}, { projection: { name: 1 } })
    .toArray();
  const names = [...new Set(accounts.map((a) => String(a.name || '').trim()).filter(Boolean))];
  console.log(`[backfill-match-scores] ${names.length} account(s), force=${force}`);

  let done = 0;
  for (const name of names) {
    const existing = await matchProfileStateCollection.findOne({ applierName: name });
    if (!force && existing?.status === 'idle' && existing.completedAt) {
      const rows = await countScoresForApplier(name);
      console.log(`  - ${name}: already completed (${rows} row(s)), skipping`);
      continue;
    }

    const state = await requestUserRescore(name);
    const claimed = await matchProfileStateCollection.findOneAndUpdate(
      { applierName: name, status: 'pending' },
      { $set: { status: 'running', startedAt: new Date().toISOString() } },
      { returnDocument: 'after' },
    );
    if (!claimed) {
      console.log(`  - ${name}: claimed elsewhere (worker running?), skipping`);
      continue;
    }

    const started = Date.now();
    const result = await rescoreUser(claimed ?? state);
    done += 1;
    console.log(
      `  - ${name}: ${result.rows ?? 0} row(s), cleared=${result.cleared ?? 0}, ${Date.now() - started}ms`,
    );
  }

  // Every user rescore covered every job — the per-job fan-out marker can
  // start clean instead of re-fanning 100K historical jobs.
  const marked = await jobsCollection.updateMany(
    { matchScoreStatus: { $ne: 'scored' } },
    { $set: { matchScoreStatus: 'scored', matchScoredAt: new Date().toISOString() } },
  );

  console.log(
    `[backfill-match-scores] rescored ${done} user(s); marked ${marked.modifiedCount} job(s) scored`,
  );
  await closeMongo?.();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
