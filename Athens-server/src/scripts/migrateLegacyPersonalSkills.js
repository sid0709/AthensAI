#!/usr/bin/env node
import 'dotenv/config';
import { MongoClient } from 'mongodb';
import { getFirestoreDb } from '../services/firebase/firebaseAdmin.js';
import { firestoreUniqueReservations } from '../db/firestoreMongoAdapter.js';
import { toCanonical } from '../services/skillNormalize.js';

const applierName = String(process.argv[2] || '').trim();
const apply = process.argv.includes('--apply');
const sourceUrl = process.env.MONGO_SOURCE_URL || 'mongodb://127.0.0.1:27017';
const sourceDbName = process.env.MONGO_SOURCE_DB || process.env.MONGO_DB || 'AthensDB';
const DEFAULT_CATEGORY = 'hard';
const DEFAULT_LEVEL = 3;
const BATCH_SIZE = 225;
const COMMIT_CONCURRENCY = 5;

if (!applierName) {
  throw new Error('Usage: node src/scripts/migrateLegacyPersonalSkills.js "Profile Name" [--apply]');
}

function inferredCategory(categoryCounts = {}) {
  const allowed = new Set(['hard', 'soft', 'devops', 'tools', 'domain']);
  const ranked = Object.entries(categoryCounts)
    .filter(([category, count]) => allowed.has(category) && Number(count) > 0)
    .sort((left, right) => Number(right[1]) - Number(left[1]));
  return ranked[0]?.[0] || DEFAULT_CATEGORY;
}

async function mapWithConcurrency(items, concurrency, worker) {
  for (let offset = 0; offset < items.length; offset += concurrency) {
    await Promise.all(items.slice(offset, offset + concurrency).map(worker));
  }
}

async function main() {
  const sourceClient = new MongoClient(sourceUrl);
  await sourceClient.connect();
  try {
    const sourceDb = sourceClient.db(sourceDbName);
    const legacyRows = await sourceDb.collection('personal_info')
      .find({}, { projection: { name: 1, canonicalId: 1, normalizedKey: 1, createdAt: 1 } })
      .toArray();
    const byCanonical = new Map();
    for (const row of legacyRows) {
      const name = String(row.name || '').trim();
      const nameCanonical = String(row.canonicalId || row.normalizedKey || toCanonical(name)).trim();
      if (!name || !nameCanonical || byCanonical.has(nameCanonical)) continue;
      byCanonical.set(nameCanonical, { name, nameCanonical, createdAt: row.createdAt || null });
    }

    const canonicalNames = [...byCanonical.keys()];
    const categoryByCanonical = new Map();
    for (let offset = 0; offset < canonicalNames.length; offset += 1_000) {
      const docs = await sourceDb.collection('skill_dictionary').find(
        { nameCanonical: { $in: canonicalNames.slice(offset, offset + 1_000) } },
        { projection: { nameCanonical: 1, categoryCounts: 1 } },
      ).toArray();
      for (const doc of docs) {
        categoryByCanonical.set(String(doc.nameCanonical), inferredCategory(doc.categoryCounts));
      }
    }

    const firestore = getFirestoreDb();
    const account = await firestore.collection('account_info').where('name', '==', applierName).limit(1).get();
    if (account.empty) throw new Error(`Profile not found in Firestore: ${applierName}`);
    const existing = await firestore.collection('user_skills').where('applierName', '==', applierName).get();
    const existingCanonical = new Set(existing.docs.map((doc) => String(doc.data().nameCanonical || '')));
    const now = new Date();
    const rows = [...byCanonical.values()]
      .filter((row) => !existingCanonical.has(row.nameCanonical))
      .map((row) => ({
        applierName,
        name: row.name,
        nameCanonical: row.nameCanonical,
        category: categoryByCanonical.get(row.nameCanonical) || DEFAULT_CATEGORY,
        level: DEFAULT_LEVEL,
        createdAt: row.createdAt || now.toISOString(),
        updatedAt: now.toISOString(),
        migratedFrom: 'personal_info',
      }));
    const categories = rows.reduce((counts, row) => {
      counts[row.category] = (counts[row.category] || 0) + 1;
      return counts;
    }, {});

    console.log(JSON.stringify({
      applierName,
      legacyRows: legacyRows.length,
      uniqueLegacySkills: byCanonical.size,
      existingProfileSkills: existing.size,
      skillsToAdd: rows.length,
      categories,
      apply,
    }, null, 2));
    if (!apply || !rows.length) return;

    const chunks = [];
    for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
      chunks.push(rows.slice(offset, offset + BATCH_SIZE));
    }
    let completed = 0;
    await mapWithConcurrency(chunks, COMMIT_CONCURRENCY, async (chunk) => {
      const batch = firestore.batch();
      for (const row of chunk) {
        const provisional = firestoreUniqueReservations('user_skills', row, 'pending')[0];
        const id = provisional.id.slice(0, 40);
        const reservation = firestoreUniqueReservations('user_skills', row, id)[0];
        batch.set(firestore.collection('user_skills').doc(id), row, { merge: true });
        batch.set(firestore.collection('unique_reservations').doc(reservation.id), {
          collection: reservation.collection,
          keys: reservation.keys,
          values: reservation.values.map(String),
          targetId: id,
          updatedAt: now,
        }, { merge: true });
      }
      await batch.commit();
      completed += chunk.length;
      console.log(`Migrated ${completed}/${rows.length} skills`);
    });

    const stateQuery = await firestore.collection('match_profile_state')
      .where('applierName', '==', applierName).limit(1).get();
    const stateRef = stateQuery.empty
      ? firestore.collection('match_profile_state').doc()
      : stateQuery.docs[0].ref;
    await stateRef.set({
      applierName,
      profileVersion: Number(stateQuery.docs[0]?.data()?.profileVersion || 0) + 1,
      status: 'idle',
      requestedAt: now.toISOString(),
      error: null,
    }, { merge: true });
    console.log(`Migration complete for ${applierName}: ${rows.length} skills added`);
  } finally {
    await sourceClient.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
