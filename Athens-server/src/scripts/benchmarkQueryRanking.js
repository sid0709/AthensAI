import 'dotenv/config';
import { performance } from 'node:perf_hooks';
import { accountInfoCollection, initDataStore, closeDataStore } from '../db/dataStore.js';
import { initRedis, closeRedis } from '../db/redis.js';
import { initJobRankingCollection, countJobRankingPoints } from '../services/vectorStore/qdrantClient.js';
import { JobSourceTitles } from '../config/jobSources.js';
import { loadUserSkillDocs } from '../services/matching/userSkillsService.js';
import { loadCanonicalSkillDictionary } from '../services/matching/canonicalSkillDictionary.js';
import { listQueryTimeRankedJobs } from '../services/matching/jobRankingService.js';
import { shutdownRankingPool, warmRankingPool } from '../services/matching/exactRerankPool.js';

function argument(name, fallback = '') {
  const prefix = `--${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

async function timedRanking(applierName, profileId, nonce, includeExternal) {
  const started = performance.now();
  const result = await listQueryTimeRankedJobs({
    applierName,
    profileId,
    listBody: {
      sort: 'recommended',
      jobSources: JobSourceTitles.join(','),
      _benchmarkNonce: nonce,
    },
    dataQuery: {},
    scoreFilters: {},
    skip: 0,
    limit: 25,
    includeExternal,
    validationMode: true,
  });
  if (!result || result.rankingStatus !== 'fresh') throw new Error('Ranking service did not return a fresh result');
  return { durationMs: performance.now() - started, timings: result._timings || {} };
}

async function main() {
  const applierName = argument('applier');
  if (!applierName) throw new Error('Usage: npm run benchmark-query-ranking -- --applier="Name" --expected-skills=100');
  const expectedSkills = Number(argument('expected-skills', '0')) || 0;
  const minimumJobs = Number(argument('minimum-jobs', '1000000')) || 1_000_000;
  const coldRuns = Math.max(1, Number(argument('cold-runs', '10')) || 10);
  const cachedRuns = Math.max(1, Number(argument('cached-runs', '30')) || 30);
  const includeExternal = argument('include-external', 'false') === 'true';

  await initDataStore();
  await initRedis();
  if (!await initJobRankingCollection()) throw new Error('Qdrant ranking collection is unavailable');
  await Promise.all([loadCanonicalSkillDictionary(), warmRankingPool()]);
  const [account, skills, catalogSize] = await Promise.all([
    accountInfoCollection.findOne({ name: applierName }, { projection: { _id: 1 } }),
    loadUserSkillDocs(applierName),
    countJobRankingPoints({
      must: [{
        key: 'catalog',
        match: includeExternal ? { any: ['market', 'external'] } : { value: 'market' },
      }],
    }),
  ]);
  const profileId = account?._id ? String(account._id) : null;
  if (expectedSkills && skills.length !== expectedSkills) {
    throw new Error(`Expected ${expectedSkills} profile skills, found ${skills.length}`);
  }
  if (catalogSize < minimumJobs) {
    throw new Error(`Expected at least ${minimumJobs} indexed jobs, found ${catalogSize}`);
  }

  const cold = [];
  const retrieval = [];
  const rerank = [];
  const hydrate = [];
  for (let index = 0; index < coldRuns; index += 1) {
    const run = await timedRanking(applierName, profileId, `cold-${Date.now()}-${index}`, includeExternal);
    cold.push(run.durationMs);
    retrieval.push(run.timings.retrievalMs || 0);
    rerank.push(run.timings.rerankMs || 0);
    hydrate.push(run.timings.hydrateMs || 0);
  }
  const warmNonce = `warm-${Date.now()}`;
  await timedRanking(applierName, profileId, warmNonce, includeExternal);
  const cached = [];
  for (let index = 0; index < cachedRuns; index += 1) {
    cached.push((await timedRanking(applierName, profileId, warmNonce, includeExternal)).durationMs);
  }
  const result = {
    applierName,
    skillCount: skills.length,
    catalogSize,
    includeExternal,
    uncachedP95Ms: Number(percentile(cold, 0.95).toFixed(2)),
    cachedP95Ms: Number(percentile(cached, 0.95).toFixed(2)),
    retrievalP95Ms: Number(percentile(retrieval, 0.95).toFixed(2)),
    rerankP95Ms: Number(percentile(rerank, 0.95).toFixed(2)),
    hydrateP95Ms: Number(percentile(hydrate, 0.95).toFixed(2)),
  };
  result.passed = result.uncachedP95Ms <= 150 && result.cachedP95Ms <= 50;
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 2;
}

main()
  .catch((error) => {
    console.error('[ranking-benchmark] failed:', error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await shutdownRankingPool();
    await closeRedis();
    await closeDataStore();
  });
