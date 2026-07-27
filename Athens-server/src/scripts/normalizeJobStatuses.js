#!/usr/bin/env node
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { createGzip } from 'node:zlib';
import { once } from 'node:events';
import { FieldValue } from 'firebase-admin/firestore';
import { getFirestoreDb } from '../services/firebase/firebaseAdmin.js';
import {
  buildStatusProjectionData,
  jobStatusProjectionId,
} from '../services/jobStatusProjectionService.js';
import {
  createProfileIdResolver,
  normalizeCanonicalJobStatuses,
} from '../services/canonicalJobStatus.js';
import { closeRedis, getRedis, initRedis, isRedisReady } from '../db/redis.js';

const APPLY = process.argv.includes('--apply');
const backupArg = process.argv.find((arg) => arg.startsWith('--backup='));
const defaultBackup = path.resolve(
  process.cwd(),
  'backups',
  `job-statuses-${new Date().toISOString().replaceAll(':', '-')}.ndjson.gz`,
);
const backupPath = path.resolve(backupArg ? backupArg.slice('--backup='.length) : defaultBackup);

function json(value) {
  return JSON.stringify(value, (_key, child) => {
    if (child && typeof child?.toDate === 'function') return child.toDate().toISOString();
    return child;
  });
}

async function readCanonicalPlan(firestore, resolveProfileId) {
  const records = [];
  const issues = [];
  let scanned = 0;
  const stream = firestore.collection('jobs')
    .select('status', 'statusProfileIds', 'postedAt', 'createdAt', 'sourceCatalog', 'version', 'extensionV2')
    .stream();
  for await (const document of stream) {
    const job = document.data();
    const original = Array.isArray(job.status) ? job.status : [];
    const normalized = normalizeCanonicalJobStatuses(original, resolveProfileId);
    for (const issue of normalized.issues) issues.push({ jobId: document.id, ...issue });
    records.push({
      jobId: document.id,
      originalStatus: original,
      hadStatusProfileIds: Object.hasOwn(job, 'statusProfileIds'),
      status: normalized.statuses,
      job: {
        postedAt: job.postedAt || job.createdAt || null,
        sourceCatalog: job.sourceCatalog || 'market',
        version: job.version || null,
        extensionV2: Boolean(job.extensionV2),
      },
      changed: json(original) !== json(normalized.statuses) || Object.hasOwn(job, 'statusProfileIds'),
    });
    scanned += 1;
  }
  return { records, issues, scanned };
}

async function writeBackup(records) {
  await fs.promises.mkdir(path.dirname(backupPath), { recursive: true });
  const output = fs.createWriteStream(backupPath, { flags: 'wx' });
  const gzip = createGzip({ level: 9 });
  gzip.pipe(output);
  for (const record of records) {
    if (!record.originalStatus.length && !record.hadStatusProfileIds) continue;
    if (!gzip.write(`${json({ jobId: record.jobId, status: record.originalStatus })}\n`)) {
      await once(gzip, 'drain');
    }
  }
  gzip.end();
  await once(output, 'close');
}

async function applyCanonicalJobs(firestore, records) {
  const writer = firestore.bulkWriter();
  writer.onWriteError((error) => error.failedAttempts < 5);
  let changed = 0;
  for (const record of records) {
    if (!record.changed) continue;
    writer.update(firestore.collection('jobs').doc(record.jobId), {
      status: record.status,
    });
    changed += 1;
  }
  await writer.close();
  return changed;
}

async function removeObsoleteStatusFields(firestore, records) {
  const writer = firestore.bulkWriter();
  writer.onWriteError((error) => error.failedAttempts < 5);
  let removed = 0;
  for (const record of records) {
    if (!record.hadStatusProfileIds) continue;
    writer.update(firestore.collection('jobs').doc(record.jobId), {
      statusProfileIds: FieldValue.delete(),
    });
    removed += 1;
  }
  await writer.close();
  return removed;
}

async function rebuildProjections(firestore, records, profileIds) {
  await Promise.all([
    firestore.recursiveDelete(firestore.collection('job_statuses')),
    firestore.recursiveDelete(firestore.collection('job_status_counts')),
  ]);
  const writer = firestore.bulkWriter();
  writer.onWriteError((error) => error.failedAttempts < 5);
  const expected = new Map();
  const marketTotal = records.filter((record) => record.job.sourceCatalog === 'market').length;
  const expectedCounts = new Map(profileIds.map((profileId) => [String(profileId), {
    profileId: String(profileId),
    all: marketTotal,
    posted: marketTotal,
    any: 0,
    rawApplied: 0,
    applied: 0,
    scheduled: 0,
    declined: 0,
    'bid-ready': 0,
    'bid-completed': 0,
    other: 0,
  }]));
  for (const record of records) {
    for (const statusRow of record.status) {
      const projection = buildStatusProjectionData({
        profileId: statusRow.applier,
        jobId: record.jobId,
        job: record.job,
        statuses: [statusRow],
      });
      const id = jobStatusProjectionId(statusRow.applier, record.jobId);
      expected.set(id, projection.statusFingerprint);
      writer.set(firestore.collection('job_statuses').doc(id), projection, { merge: false });
      const counts = expectedCounts.get(String(statusRow.applier));
      if (record.job.sourceCatalog === 'market') {
        counts.any += 1;
        for (const [field, value] of Object.entries(projection.contribution || {})) {
          if (field in counts) counts[field] += Number(value || 0);
        }
        if (!projection.states?.length) counts.other += 1;
      }
    }
  }
  for (const counts of expectedCounts.values()) {
    counts.posted = Math.max(0, marketTotal - counts.any);
    writer.set(
      firestore.collection('job_status_counts').doc(counts.profileId),
      { ...counts, schemaVersion: 2, updatedAt: new Date() },
      { merge: false },
    );
  }
  await writer.close();

  const snapshot = await firestore.collection('job_statuses')
    .select('schemaVersion', 'statusFingerprint')
    .get();
  if (snapshot.size !== expected.size) {
    throw new Error(`Projection count mismatch: expected ${expected.size}, found ${snapshot.size}`);
  }
  for (const document of snapshot.docs) {
    const projection = document.data();
    if (projection.schemaVersion !== 2 || expected.get(document.id) !== projection.statusFingerprint) {
      throw new Error(`Projection verification failed for ${document.id}`);
    }
  }
  const countSnapshot = await firestore.collection('job_status_counts').get();
  if (countSnapshot.size !== expectedCounts.size) {
    throw new Error(`Status count projection mismatch: expected ${expectedCounts.size}, found ${countSnapshot.size}`);
  }
  for (const document of countSnapshot.docs) {
    const actual = document.data();
    const expectedCount = expectedCounts.get(document.id);
    if (!expectedCount || Object.keys(expectedCount).some((field) => Number.isFinite(expectedCount[field])
      ? Number(actual[field]) !== expectedCount[field]
      : actual[field] !== expectedCount[field])) {
      throw new Error(`Status count verification failed for ${document.id}`);
    }
  }
  return { statuses: expected.size, counts: expectedCounts.size };
}

async function clearStatusCaches() {
  await initRedis({ force: true });
  if (!isRedisReady()) return 0;
  const redis = getRedis();
  let deleted = 0;
  for await (const keys of redis.scanIterator({ MATCH: 'ranking:v5:job-status*', COUNT: 500 })) {
    const batch = Array.isArray(keys) ? keys : [keys];
    if (batch.length) deleted += await redis.del(batch);
  }
  await closeRedis();
  return deleted;
}

function projectionCounts(profileId, rows) {
  const counts = {
    profileId,
    any: rows.length,
    rawApplied: 0,
    applied: 0,
    scheduled: 0,
    declined: 0,
    'bid-ready': 0,
    'bid-completed': 0,
    other: 0,
  };
  for (const { projection } of rows) {
    for (const [field, value] of Object.entries(projection.contribution || {})) {
      if (field in counts) counts[field] += Number(value || 0);
    }
    if (!projection.states?.length) counts.other += 1;
  }
  return counts;
}

async function rebuildRedisStatusIndexes(records, profileIds = []) {
  await initRedis({ force: true });
  if (!isRedisReady()) return { available: false, written: 0 };
  const redis = getRedis();
  const rowsByProfile = new Map(profileIds.map((profileId) => [String(profileId), []]));
  for (const record of records) {
    for (const statusRow of record.status) {
      const profileId = String(statusRow.applier);
      const projection = buildStatusProjectionData({
        profileId,
        jobId: record.jobId,
        job: record.job,
        statuses: [statusRow],
      });
      const rows = rowsByProfile.get(profileId) || [];
      rows.push({ jobId: record.jobId, statusRow, projection });
      rowsByProfile.set(profileId, rows);
    }
  }

  let written = 0;
  let pipeline = redis.multi();
  let pending = 0;
  const flush = async () => {
    if (!pending) return;
    await pipeline.exec();
    written += pending;
    pipeline = redis.multi();
    pending = 0;
  };
  const queue = async (method, ...args) => {
    pipeline[method](...args);
    pending += 1;
    if (pending >= 500) await flush();
  };

  for (const [profileId, rows] of rowsByProfile) {
    rows.sort((left, right) =>
      (Date.parse(right.projection.postedAt || 0) || 0) -
      (Date.parse(left.projection.postedAt || 0) || 0),
    );
    const baseline = Object.fromEntries(
      ['applied', 'scheduled', 'declined', 'bid-ready', 'bid-completed']
        .map((state) => [state, rows.filter(({ projection }) => projection.state === state).map(({ jobId }) => jobId)]),
    );
    await queue(
      'setEx',
      `ranking:v5:job-status-ids:firestore:${profileId}:baseline`,
      7 * 24 * 60 * 60,
      JSON.stringify(baseline),
    );
    const publicRows = rows.filter(({ projection }) => !projection.extensionV2);
    await queue(
      'setEx',
      `ranking:v5:job-status-counts:firestore:${profileId}:all`,
      7 * 24 * 60 * 60,
      JSON.stringify(projectionCounts(profileId, rows)),
    );
    await queue(
      'setEx',
      `ranking:v5:job-status-counts:firestore:${profileId}:public`,
      7 * 24 * 60 * 60,
      JSON.stringify(projectionCounts(profileId, publicRows)),
    );
    for (const { jobId, statusRow } of rows) {
      await queue(
        'setEx',
        `ranking:v5:job-status:firestore:${profileId}:${jobId}`,
        60 * 60,
        JSON.stringify(statusRow),
      );
    }
  }
  await flush();
  return { available: true, written };
}

async function main() {
  const firestore = getFirestoreDb();
  const accountSnapshot = await firestore.collection('account_info').get();
  const accounts = accountSnapshot.docs.map((document) => ({
    ...document.data(),
    _id: document.data()._id || document.id,
  }));
  const resolveProfileId = createProfileIdResolver(accounts);
  const plan = await readCanonicalPlan(firestore, resolveProfileId);
  const changed = plan.records.filter((record) => record.changed).length;
  const statusRows = plan.records.reduce((sum, record) => sum + record.status.length, 0);
  console.log(`[job-status] scanned=${plan.scanned} changed=${changed} canonicalRows=${statusRows} issues=${plan.issues.length}`);
  if (plan.issues.length) {
    console.error(json(plan.issues.slice(0, 100)));
    throw new Error('Canonical status validation failed; no writes were performed');
  }
  if (!APPLY) {
    console.log('[job-status] dry run complete; rerun with --apply after reviewing the counts');
    return;
  }

  await writeBackup(plan.records);
  const updated = await applyCanonicalJobs(firestore, plan.records);
  const projections = await rebuildProjections(
    firestore,
    plan.records,
    accounts.map((account) => String(account._id)),
  );
  const deletedCacheKeys = await clearStatusCaches();
  const redisIndexes = await rebuildRedisStatusIndexes(
    plan.records,
    accounts.map((account) => String(account._id)),
  );
  // The obsolete helper field is removed only after the canonical source and
  // every derived projection have passed fingerprint verification.
  const removedObsoleteFields = await removeObsoleteStatusFields(firestore, plan.records);
  console.log(`[job-status] backup=${backupPath}`);
  console.log(`[job-status] updatedJobs=${updated} projections=${projections.statuses} countProjections=${projections.counts} clearedRedisKeys=${deletedCacheKeys}`);
  console.log(`[job-status] redisAvailable=${redisIndexes.available} redisIndexes=${redisIndexes.written} removedStatusProfileIds=${removedObsoleteFields}`);
  await closeRedis();
}

main().catch(async (error) => {
  try { await closeRedis(); } catch { /* ignore */ }
  console.error(error);
  process.exitCode = 1;
});
