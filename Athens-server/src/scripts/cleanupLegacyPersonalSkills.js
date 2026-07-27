#!/usr/bin/env node
import 'dotenv/config';
import crypto from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FieldValue } from 'firebase-admin/firestore';
import { getFirestoreDb } from '../services/firebase/firebaseAdmin.js';
import { firestoreUniqueReservations } from '../db/firestoreMongoAdapter.js';
import { closeRedis, getRedis, initRedis } from '../db/redis.js';

const MIGRATION_TAG = 'personal_info';
const DELETE_BATCH_SIZE = 200;
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(scriptDir, '../..');

export function selectMigrationTaggedSkillDocs(docs = []) {
  return docs.filter((doc) => doc.data()?.migratedFrom === MIGRATION_TAG);
}

function safeFileSegment(value) {
  return String(value || 'profile')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'profile';
}

function timestampForFile(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

async function writeVerifiedBackup(applierName, docs) {
  const backupDir = path.join(serverRoot, 'migration-output', 'skill-cleanups');
  const backupPath = path.join(
    backupDir,
    `${safeFileSegment(applierName)}-${timestampForFile()}.json`,
  );
  const backup = {
    schemaVersion: 1,
    applierName,
    migrationTag: MIGRATION_TAG,
    exportedAt: new Date().toISOString(),
    count: docs.length,
    documents: docs.map((doc) => ({ id: doc.id, data: doc.data() })),
  };
  await mkdir(backupDir, { recursive: true });
  await writeFile(backupPath, `${JSON.stringify(backup, null, 2)}\n`, { flag: 'wx' });
  const verified = JSON.parse(await readFile(backupPath, 'utf8'));
  if (verified.count !== docs.length || verified.documents?.length !== docs.length) {
    throw new Error(`Backup verification failed: ${backupPath}`);
  }
  return backupPath;
}

async function deleteTaggedSkills(firestore, docs) {
  let deleted = 0;
  for (let offset = 0; offset < docs.length; offset += DELETE_BATCH_SIZE) {
    const chunk = docs.slice(offset, offset + DELETE_BATCH_SIZE);
    const batch = firestore.batch();
    for (const doc of chunk) {
      batch.delete(doc.ref);
      for (const reservation of firestoreUniqueReservations('user_skills', doc.data(), doc.id)) {
        batch.delete(firestore.collection('unique_reservations').doc(reservation.id));
      }
    }
    await batch.commit();
    deleted += chunk.length;
    console.log(`Deleted ${deleted}/${docs.length} migration-tagged skills`);
  }
  return deleted;
}

async function bumpProfileVersion(firestore, applierName) {
  const stateQuery = await firestore.collection('match_profile_state')
    .where('applierName', '==', applierName)
    .limit(1)
    .get();
  const now = new Date().toISOString();
  if (!stateQuery.empty) {
    await stateQuery.docs[0].ref.set({
      profileVersion: FieldValue.increment(1),
      status: 'idle',
      requestedAt: now,
      error: null,
    }, { merge: true });
    return;
  }

  const provisional = firestoreUniqueReservations(
    'match_profile_state',
    { applierName },
    'pending',
  )[0];
  const id = provisional.id.slice(0, 40);
  const reservation = firestoreUniqueReservations(
    'match_profile_state',
    { applierName },
    id,
  )[0];
  const batch = firestore.batch();
  batch.set(firestore.collection('match_profile_state').doc(id), {
    applierName,
    profileVersion: 1,
    status: 'idle',
    requestedAt: now,
    error: null,
  });
  batch.set(firestore.collection('unique_reservations').doc(reservation.id), {
    collection: reservation.collection,
    keys: reservation.keys,
    values: reservation.values.map(String),
    targetId: id,
    updatedAt: new Date(),
  }, { merge: true });
  await batch.commit();
}

async function clearProfileCaches(applierName) {
  const connected = await initRedis({ force: true });
  if (!connected) return [];
  const redis = getRedis();
  const owner = crypto.createHash('sha256').update(applierName).digest('hex').slice(0, 16);
  const versionOwner = crypto.createHash('sha256').update(applierName).digest('hex').slice(0, 20);
  const keys = [
    `profile:skill-docs:${applierName}`,
    `profile:skills:${applierName}`,
    `profile:match:${applierName}`,
    `ranking:v2:profile-version:${versionOwner}`,
  ];
  await redis.incr(`profile:skills-revision:${applierName}`);
  for await (const key of redis.scanIterator({
    MATCH: `ranking:v2:${owner}:*`,
    COUNT: 1_000,
  })) {
    keys.push(key);
  }
  const uniqueKeys = [...new Set(keys)];
  const deleted = [];
  for (const key of uniqueKeys) {
    if (await redis.del(key)) deleted.push(key);
  }
  await closeRedis();
  return deleted;
}

export async function cleanupLegacyPersonalSkills({ applierName, apply = false } = {}) {
  const name = String(applierName || '').trim();
  if (!name) throw new Error('A profile name is required');

  const firestore = getFirestoreDb();
  const account = await firestore.collection('account_info')
    .where('name', '==', name)
    .limit(1)
    .get();
  if (account.empty) throw new Error(`Profile not found in Firestore: ${name}`);

  const snapshot = await firestore.collection('user_skills')
    .where('applierName', '==', name)
    .get();
  const tagged = selectMigrationTaggedSkillDocs(snapshot.docs);
  const summary = {
    applierName: name,
    totalProfileSkills: snapshot.size,
    migrationTaggedSkills: tagged.length,
    preservedSkills: snapshot.size - tagged.length,
    apply,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!apply || tagged.length === 0) return { ...summary, deleted: 0, backupPath: null };

  const backupPath = await writeVerifiedBackup(name, tagged);
  console.log(`Verified backup: ${backupPath}`);
  const deleted = await deleteTaggedSkills(firestore, tagged);

  const verification = await firestore.collection('user_skills')
    .where('applierName', '==', name)
    .get();
  const remainingTagged = selectMigrationTaggedSkillDocs(verification.docs).length;
  const remainingPreserved = verification.size - remainingTagged;
  if (remainingTagged !== 0 || remainingPreserved !== summary.preservedSkills) {
    throw new Error(
      `Cleanup verification failed: ${remainingTagged} tagged and ${remainingPreserved} preserved rows remain`,
    );
  }

  await bumpProfileVersion(firestore, name);
  const cacheKeysDeleted = await clearProfileCaches(name);
  const result = {
    ...summary,
    deleted,
    backupPath,
    remainingProfileSkills: verification.size,
    cacheKeysDeleted,
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function main() {
  const applierName = String(process.argv[2] || '').trim();
  const apply = process.argv.includes('--apply');
  if (!applierName) {
    throw new Error(
      'Usage: node src/scripts/cleanupLegacyPersonalSkills.js "Profile Name" [--apply]',
    );
  }
  await cleanupLegacyPersonalSkills({ applierName, apply });
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch(async (error) => {
    console.error(error);
    await closeRedis().catch(() => {});
    process.exitCode = 1;
  });
}
