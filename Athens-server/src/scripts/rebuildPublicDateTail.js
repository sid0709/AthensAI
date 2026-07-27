import 'dotenv/config';
import { closeRedis, initRedis, isRedisReady } from '../db/redis.js';
import { rebuildPublicDateTailFromRankingIndex } from '../services/matching/jobRankingIndex.js';
import {
  initJobRankingCollection,
  initQdrantCollections,
} from '../services/vectorStore/qdrantClient.js';

async function main() {
  await initRedis({ force: true });
  if (!isRedisReady()) throw new Error('Redis is not ready');
  const [legacyReady, rankingReady] = await Promise.all([
    initQdrantCollections(),
    initJobRankingCollection(),
  ]);
  if (!legacyReady || !rankingReady) throw new Error('Qdrant is not ready');
  const result = await rebuildPublicDateTailFromRankingIndex();
  console.log('[ranking-public-tail] complete', result);
}

main()
  .catch((error) => {
    console.error('[ranking-public-tail] failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeRedis();
  });
