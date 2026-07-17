/**
 * Best-effort backfill of `llm_call_log.applierName`.
 *
 * Some older `llm_call_log` rows were written without `applierName`
 * (missing `x-applier-name` header). When `runId` is present we can often
 * infer the owner by looking up `avalon_apply_runs.applierName`.
 *
 * Usage:
 *   node src/scripts/backfillLlmCallLogApplierName.js [--limit N]
 */
import dotenv from 'dotenv';
dotenv.config();

import { initMongo, llmCallLogCollection, avalonRunsCollection, closeMongo } from '../db/mongo.js';

function readArgLimit(argv, defaultLimit = 300) {
  const idx = argv.indexOf('--limit');
  if (idx === -1) return defaultLimit;
  const raw = argv[idx + 1];
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n <= 0) return defaultLimit;
  return Math.floor(n);
}

async function main() {
  await initMongo();
  if (!llmCallLogCollection) throw new Error('MongoDB not ready (llm_call_log missing)');
  if (!avalonRunsCollection) throw new Error('MongoDB not ready (avalon_apply_runs missing)');

  const limit = readArgLimit(process.argv, 300);

  const cursor = llmCallLogCollection.find(
    {
      $and: [
        {
          $or: [{ applierName: { $exists: false } }, { applierName: null }, { applierName: '' }],
        },
        { runId: { $exists: true, $type: 'string', $ne: '' } },
      ],
    },
    { projection: { requestId: 1, runId: 1, applierName: 1 } },
  ).limit(limit);

  let scanned = 0;
  let updated = 0;
  let skipped = 0;

  for await (const row of cursor) {
    scanned += 1;
    const runId = row.runId;
    if (!runId) {
      skipped += 1;
      continue;
    }

    const run = await avalonRunsCollection.findOne(
      { runId },
      { projection: { applierName: 1 } },
    );

    const owner = typeof run?.applierName === 'string' ? run.applierName.trim() : '';
    if (!owner) {
      skipped += 1;
      continue;
    }

    await llmCallLogCollection.updateOne(
      { requestId: row.requestId },
      { $set: { applierName: owner } },
    );
    updated += 1;
  }

  console.log(`[backfill-llm-call-log-applier-name] scanned=${scanned} updated=${updated} skipped=${skipped}`);

  await closeMongo?.();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

