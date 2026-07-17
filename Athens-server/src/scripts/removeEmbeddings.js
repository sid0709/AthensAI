/**
 * Remove all embedding data stored in MongoDB (the app no longer uses Qdrant /
 * Ollama embeddings). Unsets the `embedding` field on jobs and the
 * `embedding` / `profileEmbedding` fields on resumes. Batched so large
 * collections stay responsive.
 *
 * Usage: node src/scripts/removeEmbeddings.js
 */
import dotenv from 'dotenv';
dotenv.config();

import { initMongo, closeMongo, jobsCollection, userResumesCollection } from '../db/mongo.js';

const BATCH = 5000;

async function batchUnset(collection, filter, unset, label) {
  if (!collection) return 0;
  const cursor = collection.find(filter, { projection: { _id: 1 } });
  let ops = [];
  let updated = 0;
  const flush = async () => {
    if (!ops.length) return;
    await collection.bulkWrite(ops, { ordered: false });
    updated += ops.length;
    ops = [];
    console.log(`  … ${label}: ${updated} updated`);
  };
  for await (const doc of cursor) {
    ops.push({ updateOne: { filter: { _id: doc._id }, update: { $unset: unset } } });
    if (ops.length >= BATCH) await flush();
  }
  await flush();
  return updated;
}

async function main() {
  await initMongo();
  if (!jobsCollection) throw new Error('MongoDB not ready');

  console.log('[remove-embeddings] clearing job embeddings…');
  const jobs = await batchUnset(jobsCollection, { embedding: { $exists: true } }, { embedding: '' }, 'jobs');

  console.log('[remove-embeddings] clearing resume embeddings…');
  const resumes = await batchUnset(
    userResumesCollection,
    { $or: [{ embedding: { $exists: true } }, { profileEmbedding: { $exists: true } }] },
    { embedding: '', profileEmbedding: '' },
    'resumes',
  );

  console.log('[remove-embeddings] done:', { jobsCleared: jobs, resumesCleared: resumes });
  await closeMongo?.();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
