import 'dotenv/config';
import {
  initMongo,
  closeMongo,
  getMongoDb,
  jobsCollection,
  externalScrapedJobsCollection,
  skillDictionaryCollection,
} from '../db/mongo.js';
import { initRedis, closeRedis, isRedisReady } from '../db/redis.js';
import {
  activateJobRankingCollection,
  initQdrantCollections,
  initJobRankingCollection,
  countJobRankingPoints,
  getJobVectors,
} from '../services/vectorStore/qdrantClient.js';
import { JOB_RANKINGS_COLLECTION } from '../services/vectorStore/collections.js';
import { stableSkillId } from '../services/matching/canonicalSkillVectors.js';
import {
  loadCanonicalSkillDictionary,
  publishCanonicalSkillDictionaryChange,
} from '../services/matching/canonicalSkillDictionary.js';
import {
  indexJobRankingBatch,
  markPublicDateTailReady,
  preparePublicDateTailRebuild,
} from '../services/matching/jobRankingIndex.js';

const BATCH_SIZE = Math.max(25, Number(process.env.RANKING_BACKFILL_BATCH || 200));
const SKIP_DICTIONARY = process.argv.includes('--skip-dictionary');

async function backfillDictionaryIds() {
  const options = { projection: { _id: 1, nameCanonical: 1, skillId: 1 } };
  const cursor = typeof skillDictionaryCollection.findPaged === 'function'
    ? skillDictionaryCollection.findPaged({}, { ...options, pageSize: 1_000 })
    : skillDictionaryCollection.find({}, options);
  const assignments = [];
  const namesById = new Map();
  for await (const doc of cursor) {
    const canonical = String(doc.nameCanonical || '').trim();
    if (!canonical) continue;
    const skillId = Number(doc.skillId) || stableSkillId(canonical);
    const collision = namesById.get(skillId);
    if (collision && collision !== canonical) {
      throw new Error(`Canonical skill id collision: ${collision} and ${canonical} -> ${skillId}`);
    }
    namesById.set(skillId, canonical);
    if (!Number(doc.skillId)) assignments.push({ id: String(doc._id), skillId });
  }

  const nativeFirestore = getMongoDb()?.firestore;
  if (assignments.length && nativeFirestore) {
    const writer = nativeFirestore.bulkWriter();
    for (const assignment of assignments) {
      writer.set(
        nativeFirestore.collection('skill_dictionary').doc(assignment.id),
        { skillId: assignment.skillId },
        { merge: true },
      );
    }
    await writer.close();
  } else {
    for (let offset = 0; offset < assignments.length; offset += BATCH_SIZE) {
      const ops = assignments.slice(offset, offset + BATCH_SIZE).map((assignment) => ({
        updateOne: {
          filter: { _id: assignment.id },
          update: { $set: { skillId: assignment.skillId } },
        },
      }));
      await skillDictionaryCollection.bulkWrite(ops, { ordered: false });
    }
  }
  await publishCanonicalSkillDictionaryChange();
  const snapshot = await loadCanonicalSkillDictionary({ force: true });
  return { updated: assignments.length, dictionaryVersion: snapshot.version, skills: snapshot.byName.size };
}

async function backfillCollection(collection, catalog) {
  if (!collection) return { indexed: 0 };
  const options = {
    projection: {
      title: 1, jobTitle: 1, company: 1, companyName: 1, location: 1, details: 1,
      source: 1, postedAt: 1, createdAt: 1, _createdAt: 1, version: 1, extensionV2: 1,
			companyId: 1, companyNameNormalized: 1, companyDomain: 1,
			companyIdentitySource: 1, companyIdentityVersion: 1,
      aiSkills: 1, skills: 1, titleScanned: 1, active: 1, companyIcon: 1, companyLink: 1,
      applyLink: 1, jobLink: 1, sender: 1, postedAgo: 1, tags: 1, applicants: 1,
      skillAnalysis: 1, aiSkillStatus: 1, aiSkillExtractedAt: 1,
    },
  };
  const cursor = typeof collection.findPaged === 'function'
    ? collection.findPaged({}, { ...options, pageSize: BATCH_SIZE })
    : collection.find({}, options);
  let batch = [];
  let indexed = 0;
  for await (const job of cursor) {
    batch.push(job);
    if (batch.length >= BATCH_SIZE) {
      const semanticVectors = await getJobVectors(batch.map((item) => String(item._id)));
      indexed += (await indexJobRankingBatch(batch, {
        catalog,
        wait: true,
        semanticVectors,
        collectionName: JOB_RANKINGS_COLLECTION,
      })).indexed;
      batch = [];
      console.log(`[ranking-backfill] ${catalog}: ${indexed} indexed`);
    }
  }
  if (batch.length) {
    const semanticVectors = await getJobVectors(batch.map((item) => String(item._id)));
    indexed += (await indexJobRankingBatch(batch, {
      catalog,
      wait: true,
      semanticVectors,
      collectionName: JOB_RANKINGS_COLLECTION,
    })).indexed;
  }
  return { indexed };
}

async function main() {
  await initMongo();
  await initRedis({ force: true });
  if (!isRedisReady()) throw new Error('Redis is required for the ranking backfill');
  const legacyReady = await initQdrantCollections();
  const rankingReady = await initJobRankingCollection({
    collectionName: JOB_RANKINGS_COLLECTION,
    ensureAlias: false,
  });
  if (!legacyReady || !rankingReady) throw new Error('Qdrant is not ready');

  const dictionary = SKIP_DICTIONARY
    ? { skipped: true }
    : await backfillDictionaryIds();
  await preparePublicDateTailRebuild();
  const market = await backfillCollection(jobsCollection, 'market');
  const external = await backfillCollection(externalScrapedJobsCollection, 'external');
  const indexed = await countJobRankingPoints(undefined, { collectionName: JOB_RANKINGS_COLLECTION });
  const expected = market.indexed + external.indexed;
  if (indexed !== expected) {
    throw new Error(`Qdrant document count mismatch: expected ${expected}, found ${indexed}`);
  }
  await activateJobRankingCollection(JOB_RANKINGS_COLLECTION);
  await markPublicDateTailReady();
  console.log('[ranking-backfill] complete', { dictionary, market, external, indexed });
}

main()
  .catch((error) => {
    console.error('[ranking-backfill] failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeRedis();
    await closeMongo();
  });
