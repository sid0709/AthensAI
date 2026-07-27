import 'dotenv/config';
import { initDataStore, closeDataStore, jobsCollection } from '../db/dataStore.js';
import { initRedis, closeRedis } from '../db/redis.js';
import { initJobRankingCollection } from '../services/vectorStore/qdrantClient.js';
import { JobSourceTitles } from '../config/jobSources.js';
import { loadProfileMatchContext } from '../services/matching/profileSkills.js';
import { enrichJobSkillsFromTitle } from '../services/matching/jobSkillExtraction.js';
import { computeCoverageScore } from '../services/matching/coverageScore.js';
import { listQueryTimeRankedJobs } from '../services/matching/jobRankingService.js';
import { ndcgAtK, recallAtK } from '../services/matching/rankingEvaluation.js';
import { shutdownRankingPool } from '../services/matching/exactRerankPool.js';

function argument(name) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : '';
}

function addTopRow(rows, row, limit) {
  rows.push(row);
  rows.sort((left, right) =>
    right.relevance - left.relevance ||
    String(right.postedAt || '').localeCompare(String(left.postedAt || '')) ||
    String(right.id).localeCompare(String(left.id)),
  );
  if (rows.length > limit) rows.length = limit;
}

async function exhaustiveTop(applierName, limit = 100, trackedIds = new Set()) {
  const profile = await loadProfileMatchContext(applierName);
  const rows = [];
  const tracked = [];
  const options = {
    projection: {
      _id: 1,
      title: 1,
      postedAt: 1,
      _createdAt: 1,
      aiSkills: 1,
      skills: 1,
    },
  };
  const cursor = typeof jobsCollection.findPaged === 'function'
    ? jobsCollection.findPaged({}, { ...options, pageSize: 1_000 })
    : jobsCollection.find({}, options);
  for await (const job of cursor) {
    const hasAi = Array.isArray(job.aiSkills) && job.aiSkills.length;
    const enriched = enrichJobSkillsFromTitle(job);
    const jobSkills = hasAi ? job.aiSkills : enriched.skills;
    const coverage = computeCoverageScore(jobSkills, profile);
    const row = {
      id: String(job._id),
      relevance: coverage.matchScore,
      postedAt: job.postedAt || job._createdAt || null,
    };
    addTopRow(rows, row, limit);
    if (trackedIds.has(row.id)) tracked.push(row);
  }
  return { top: rows, tracked };
}

async function main() {
  const applierName = argument('applier');
  if (!applierName) throw new Error('Usage: npm run validate-query-ranking -- --applier="Name"');
  await initDataStore();
  await initRedis();
  if (!await initJobRankingCollection()) throw new Error('Qdrant ranking collection is unavailable');

  const actual = await listQueryTimeRankedJobs({
    applierName,
    listBody: { sort: 'recommended', jobSources: JobSourceTitles.join(',') },
    dataQuery: {},
    scoreFilters: {},
    skip: 0,
    limit: 100,
    includeExternal: false,
    validationMode: true,
  });
  if (!actual) throw new Error('Set RECOMMENDATION_QUERY_TIME_MODE=shadow before validation');
  const rankedIds = actual.docs.map((job) => String(job._id));
  const exhaustive = await exhaustiveTop(applierName, 100, new Set(rankedIds));
  const ideal = exhaustive.top;
  const evaluationRows = [...new Map(
    [...ideal, ...exhaustive.tracked].map((row) => [row.id, row]),
  ).values()];
  const relevantIds = ideal.filter((row) => row.relevance > 0).map((row) => row.id);
  const recall = recallAtK(actual._candidateJobIds || [], relevantIds, 100);
  const ndcg = ndcgAtK(rankedIds, evaluationRows, 100);
  const result = {
    applierName,
    recallAt100: Number(recall.toFixed(6)),
    ndcgAt100: Number(ndcg.toFixed(6)),
    recallTarget: 0.99,
    ndcgTarget: 0.99,
    passed: recall >= 0.99 && ndcg >= 0.99,
  };
  if (!result.passed) {
    const rankedSet = new Set(rankedIds);
    const idealById = new Map(ideal.map((row) => [row.id, row]));
    const diagnosticsById = new Map((actual._diagnostics || []).map((row) => [String(row.jobId), row]));
    result.diagnostics = {
      returned: rankedIds.length,
      candidates: actual._candidateJobIds?.length || 0,
      missingIdealIds: ideal.map((row) => row.id).filter((id) => !rankedSet.has(id)).slice(0, 10),
      unexpectedRankedIds: rankedIds.filter((id) => !idealById.has(id)).slice(0, 10),
      scoreDeltas: rankedIds.flatMap((id) => {
        const expected = idealById.get(id)?.relevance;
        const actualScore = diagnosticsById.get(id)?.exactScore;
        return expected != null && actualScore != null && expected !== actualScore
          ? [{ id, expected, actual: actualScore }]
          : [];
      }).slice(0, 10),
      idealHead: ideal.slice(0, 10).map((row) => ({ id: row.id, score: row.relevance })),
      rankedHead: rankedIds.slice(0, 10).map((id) => ({ id, score: diagnosticsById.get(id)?.exactScore })),
    };
  }
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 2;
}

try {
  await main();
} catch (error) {
  console.error('[ranking-validation] failed:', error?.message || error);
  process.exitCode = 1;
} finally {
  await shutdownRankingPool();
  await closeRedis();
  await closeDataStore();
}
