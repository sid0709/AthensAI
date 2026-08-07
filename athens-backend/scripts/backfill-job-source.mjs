#!/usr/bin/env node
/**
 * Re-derive `source` on jobs / temp_jobs / vendor_tasks from apply URL hosts
 * using the canonical `@nextoffer/shared/job-source` catalog (SOURCE_MAP_VERSION).
 *
 * Usage:
 *   npm run backfill:job-source
 *   npm run backfill:job-source -- --dry-run
 */
import 'dotenv/config';
import { MongoClient } from 'mongodb';
import {
  inferJobSource,
  SOURCE_MAP_VERSION,
} from '@nextoffer/shared/job-source';

const CHUNK = 500;

function requireDbUrl() {
  const url = String(process.env.DATABASE_URL || '').trim();
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  return url;
}

function isDryRun(argv) {
  return argv.includes('--dry-run');
}

/**
 * @param {import('mongodb').Collection} collection
 * @param {{ urlField: string, label: string, dryRun: boolean }} opts
 */
async function cleanseCollection(collection, { urlField, label, dryRun }) {
  const stats = {
    scanned: 0,
    unchanged: 0,
    updated: 0,
    missingUrl: 0,
    samples: /** @type {Array<{ id: string, from: string, to: string, url: string }>} */ ([]),
  };

  const cursor = collection.find(
    {},
    { projection: { [urlField]: 1, source: 1 } },
  );

  /** @type {import('mongodb').AnyBulkWriteOperation[]} */
  let ops = [];

  const flush = async () => {
    if (!ops.length) return;
    if (dryRun) {
      ops = [];
      return;
    }
    for (let i = 0; i < ops.length; i += CHUNK) {
      const slice = ops.slice(i, i + CHUNK);
      const result = await collection.bulkWrite(slice, { ordered: false });
      console.log(
        `[backfill:job-source] ${label} chunk ${Math.floor(i / CHUNK) + 1}: ` +
          `modified=${result.modifiedCount || 0}`,
      );
    }
    ops = [];
  };

  for await (const doc of cursor) {
    stats.scanned += 1;
    const rawUrl = doc[urlField];
    const url = typeof rawUrl === 'string' ? rawUrl.trim() : '';
    if (!url) stats.missingUrl += 1;

    const next = inferJobSource(url || null);
    const prev = typeof doc.source === 'string' ? doc.source.trim() : '';
    if (prev === next) {
      stats.unchanged += 1;
      continue;
    }

    stats.updated += 1;
    if (stats.samples.length < 12) {
      stats.samples.push({
        id: String(doc._id),
        from: prev || '(empty)',
        to: next,
        url: url || '(none)',
      });
    }

    ops.push({
      updateOne: {
        filter: { _id: doc._id },
        update: {
          $set: {
            source: next,
            updatedAt: new Date(),
          },
        },
      },
    });

    if (ops.length >= CHUNK) await flush();
  }

  await flush();
  return stats;
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = isDryRun(argv);
  const url = requireDbUrl();
  const client = new MongoClient(url);
  await client.connect();
  const db = client.db();

  console.log(
    `[backfill:job-source] db=${db.databaseName} dryRun=${dryRun} ` +
      `SOURCE_MAP_VERSION=${SOURCE_MAP_VERSION}`,
  );

  const t0 = Date.now();
  const targets = [
    { name: 'jobs', urlField: 'applyLink' },
    { name: 'temp_jobs', urlField: 'applyLink' },
    { name: 'vendor_tasks', urlField: 'applyUrl' },
  ];

  for (const { name, urlField } of targets) {
    const stats = await cleanseCollection(db.collection(name), {
      urlField,
      label: name,
      dryRun,
    });
    console.log(
      `[backfill:job-source] ${name}: scanned=${stats.scanned} ` +
        `updated=${stats.updated} unchanged=${stats.unchanged} ` +
        `missingUrl=${stats.missingUrl}`,
    );
    for (const sample of stats.samples) {
      console.log(
        `  sample ${sample.id}: ${sample.from} → ${sample.to} (${sample.url.slice(0, 80)})`,
      );
    }
  }

  console.log(`[backfill:job-source] done elapsed=${Date.now() - t0}ms`);
  await client.close();
}

main().catch((err) => {
  console.error('[backfill:job-source] failed', err);
  process.exit(1);
});
