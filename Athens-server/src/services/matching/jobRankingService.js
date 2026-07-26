import { ObjectId } from 'mongodb';
import { JobSourceTitles } from '../../config/jobSources.js';
import {
  getQueryTimeRankingMode,
  getQueryTimeRankingLimits,
  isHybridMatchEnabled,
  isQueryTimeRankingEnabled,
} from '../../config/graphAndVectorConfig.js';
import { isRedisReady } from '../../db/redis.js';
import { accountInfoCollection, jobsCollection, externalScrapedJobsCollection } from '../../db/mongo.js';
import { JOB_LIST_PROJECTION } from '../jobListQuery.js';
import { normalizeExternalScrapedJob } from '../externalScrapedJobsListQuery.js';
import {
  getProfileVector,
  getJobRankingPoints,
  isJobRankingReady,
  countJobRankingPoints,
  queryJobRankingDense,
  queryJobRankingSparse,
} from '../vectorStore/qdrantClient.js';
import { buildUserSkillSparseVector } from './canonicalSkillVectors.js';
import { loadCanonicalSkillDictionary } from './canonicalSkillDictionary.js';
import { loadProfileMatchContext } from './profileSkills.js';
import { loadUserSkillDocs } from './userSkillsService.js';
import { getProfileRankingVersion } from './matchScoreStore.js';
import { getCatalogRevision, readDateTailPage } from './jobRankingIndex.js';
import {
  getStatusRevision,
  publishRankingCache,
  rankingCacheKey,
  rankingFilterHash,
  readRankingCache,
} from './rankingCache.js';
import { rerankInPool } from './exactRerankPool.js';
import { computeCoverageScore, composeJobScores } from './coverageScore.js';
import { enrichJobSkillsFromTitle } from './jobSkillExtraction.js';
import { incrementCounter, observeHistogram } from '../monitoring/metrics.js';
import { readProjectedJobStatuses } from '../jobStatusProjectionService.js';

const rankingBuilds = new Map();

function coalesceRankingBuild(cacheKey, builder) {
  const existing = rankingBuilds.get(cacheKey);
  if (existing) return existing;
  const promise = builder();
  rankingBuilds.set(cacheKey, promise);
  promise.then(
    () => { if (rankingBuilds.get(cacheKey) === promise) rankingBuilds.delete(cacheKey); },
    () => { if (rankingBuilds.get(cacheKey) === promise) rankingBuilds.delete(cacheKey); },
  );
  return promise;
}

function matchKeyword(key, value) {
  if (Array.isArray(value)) return { key, match: { any: value } };
  return { key, match: { value } };
}

function matchText(key, value) {
  return { key, match: { text: String(value).trim() } };
}

export function buildJobRankingFilter(listBody = {}, { includeExternal = false, mongoQuery = null } = {}) {
  const must = [
    matchKeyword('active', true),
    matchKeyword('catalog', includeExternal ? ['market', 'external'] : 'market'),
  ];
  const sources = String(listBody.jobSources || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const known = JobSourceTitles.filter((source) => source !== 'Other');
  const allSources = sources.includes('Other') && known.every((source) => sources.includes(source));
  if (sources.length && !allSources) must.push(matchKeyword('source', sources));

  if (listBody.postedAtFrom || listBody.postedAtTo) {
    const range = {};
    if (listBody.postedAtFrom) range.gte = new Date(listBody.postedAtFrom).toISOString();
    if (listBody.postedAtTo) {
      const exclusive = new Date(listBody.postedAtTo);
      exclusive.setUTCDate(exclusive.getUTCDate() + 1);
      range.lt = exclusive.toISOString();
    }
    must.push({ key: 'postedAt', range });
  }
  if (listBody['details.remote']) must.push(matchKeyword('workMode', listBody['details.remote']));
  if (listBody['details.seniority']) {
    must.push(matchKeyword('seniority', String(listBody['details.seniority']).split(',').map((v) => v.trim()).filter(Boolean)));
  }
  if (listBody.titleScanned) {
    must.push(matchKeyword('titleRoles', String(listBody.titleScanned).split(',').map((v) => v.trim()).filter(Boolean)));
  }
  if (listBody.q) must.push(matchText('title', listBody.q));
  if (listBody['company.name']) must.push(matchText('companyName', listBody['company.name']));
  if (listBody['company.tags']) must.push(matchKeyword('companyTags', listBody['company.tags']));
  if (listBody['details.position']) must.push(matchText('location', listBody['details.position']));
  if (listBody.aiExtracted === true || listBody.aiExtracted === 'true') {
    must.push(matchKeyword('aiExtracted', true));
  }

  // Non-beta queries contain the canonical Firestore or MongoDB exclusion.
  if (queryExcludesExtensionV2Jobs(mongoQuery)) {
    must.push(matchKeyword('extensionV2', false));
  }
  return { must };
}

export function queryExcludesExtensionV2Jobs(mongoQuery = null) {
  const serializedQuery = JSON.stringify(mongoQuery || {});
  return serializedQuery.includes('"extensionV2":false') ||
    serializedQuery.includes('"extensionV2":{"$ne":true}') ||
    serializedQuery.includes('"version":{"$ne":"v2"}');
}

function postedMillis(job) {
  const value = job?.postedAt || job?._createdAt || job?.createdAt || 0;
  const millis = new Date(value).getTime();
  return Number.isFinite(millis) ? millis : 0;
}

export async function listDateRankedRankingFallback({
  mongoQuery,
  externalQuery,
  skip,
  limit,
  includeExternal = false,
  reason = 'ranking_backend_unavailable',
}) {
  let docs;
  let total;
  if (!includeExternal) {
    [docs, total] = await Promise.all([
      jobsCollection.find(mongoQuery || {}, { projection: JOB_LIST_PROJECTION })
        .sort({ postedAt: -1, _id: -1 }).skip(skip).limit(limit).toArray(),
      jobsCollection.countDocuments(mongoQuery || {}),
    ]);
  } else {
    const take = skip + limit;
    const [marketDocs, externalDocs, marketTotal, externalTotal] = await Promise.all([
      jobsCollection.find(mongoQuery || {}, { projection: JOB_LIST_PROJECTION })
        .sort({ postedAt: -1, _id: -1 }).limit(take).toArray(),
      externalScrapedJobsCollection
        ? externalScrapedJobsCollection.find(externalQuery || {})
            .sort({ postedAt: -1, createdAt: -1, _id: -1 }).limit(take).toArray()
        : [],
      jobsCollection.countDocuments(mongoQuery || {}),
      externalScrapedJobsCollection
        ? externalScrapedJobsCollection.countDocuments(externalQuery || {})
        : 0,
    ]);
    docs = [
      ...marketDocs.map((job) => ({ ...job, catalog: 'market' })),
      ...externalDocs.map((job) => normalizeExternalScrapedJob(job)),
    ]
      .sort((left, right) =>
        postedMillis(right) - postedMillis(left) ||
        String(right._id).localeCompare(String(left._id)),
      )
      .slice(skip, skip + limit);
    total = marketTotal + externalTotal;
  }
  return {
    docs,
    total,
    catalogTotal: total,
    recommendationFallback: true,
    recommendationReason: reason,
    recommendationWarming: false,
    recommendationMaterialized: false,
    rankingVersion: null,
    rankingStatus: 'fallback',
    catalogRevision: null,
    personalizedThroughRank: 0,
  };
}

function supportsRedisDateTail(body = {}) {
  const sources = String(body.jobSources || '').split(',').map((value) => value.trim()).filter(Boolean);
  const allSources = !sources.length || JobSourceTitles.every((source) => sources.includes(source));
  return allSources && !body.q && !body.postedAtFrom && !body.postedAtTo &&
    body.applied === undefined && !body.status &&
    !body['company.name'] && !body['details.position'] && !body['details.remote'] &&
    !body['details.seniority'] && !body.titleScanned && !body['company.tags'] &&
    !(body.aiExtracted === true || body.aiExtracted === 'true');
}

function hasPositiveStatusFilter(body = {}) {
  return body.applied === true || body.applied === 'true';
}

function hasPersonalStatusFilter(body = {}) {
  return body.applied !== undefined || Boolean(body.status);
}

function requiresAuthoritativeCandidateFilter(body = {}) {
  return hasPersonalStatusFilter(body)
    || Boolean(body.q)
    || Boolean(body['details.time'])
    || Boolean(body['company.tags']);
}

function profileIdFromQuery(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.applier != null) return value.applier;
  for (const nested of Object.values(value)) {
    if (Array.isArray(nested)) {
      for (const item of nested) {
        const found = profileIdFromQuery(item);
        if (found != null) return found;
      }
    } else if (nested && typeof nested === 'object') {
      const found = profileIdFromQuery(nested);
      if (found != null) return found;
    }
  }
  return null;
}

function fuseCandidates(sparseHits, denseHits) {
  const byId = new Map();
  sparseHits.forEach((hit, index) => {
    if (!hit.jobId) return;
    byId.set(String(hit.jobId), {
      jobId: String(hit.jobId),
      payload: hit.payload,
      sparseScore: hit.score * 100,
      semanticRank: null,
      fusionScore: 1 / (60 + index + 1),
    });
  });
  denseHits.forEach((hit, index) => {
    if (!hit.jobId) return;
    const id = String(hit.jobId);
    const current = byId.get(id) || {
      jobId: id,
      payload: hit.payload,
      sparseScore: 0,
      semanticRank: null,
      fusionScore: 0,
    };
    current.semanticRank = index + 1;
    current.fusionScore += 0.5 / (60 + index + 1);
    if (!current.payload?.rankSkills?.length) current.payload = hit.payload;
    byId.set(id, current);
  });
  return [...byId.values()].sort((a, b) => b.fusionScore - a.fusionScore);
}

function toObjectIds(ids) {
  return ids.map((id) => {
    try { return new ObjectId(String(id)); } catch { return String(id); }
  }).filter(Boolean);
}

async function hydratePage(entries, profileCtx, { applierName, profileId } = {}) {
  const rankingPayloads = await getJobRankingPoints(entries.map((entry) => entry.jobId));
  const rankingPayloadById = new Map(rankingPayloads.map((payload) => [String(payload.jobId), payload]));
  const hydratedEntries = entries.map((entry) => ({
    ...entry,
    payload: { ...(entry.payload || {}), ...(rankingPayloadById.get(entry.jobId) || {}) },
  }));
  const catalogOf = (entry) => entry.catalog || entry.payload?.catalog || 'market';
  const marketIds = hydratedEntries.filter((entry) => catalogOf(entry) !== 'external').map((entry) => entry.jobId);
  const externalIds = hydratedEntries.filter((entry) => catalogOf(entry) === 'external').map((entry) => entry.jobId);
  const cardDocs = hydratedEntries.flatMap((entry) => {
    const card = entry.payload?.card;
    return card && typeof card === 'object'
      ? [{ ...card, _id: entry.jobId, aiSkills: entry.payload?.aiSkills || [] }]
      : [];
  });
  const cardIds = new Set(cardDocs.map((doc) => String(doc._id)));
  const missingMarketIds = marketIds.filter((id) => !cardIds.has(id));
  const missingExternalIds = externalIds.filter((id) => !cardIds.has(id));
  let resolvedProfileId = profileId;
  if (!resolvedProfileId && applierName && accountInfoCollection) {
    const account = await accountInfoCollection.findOne(
      { name: String(applierName).trim() },
      { projection: { _id: 1 } },
    );
    resolvedProfileId = account?._id ? String(account._id) : null;
  }
  const [marketDocs, externalDocs, projectedStatuses] = await Promise.all([
    missingMarketIds.length
      ? jobsCollection.find({ _id: { $in: toObjectIds(missingMarketIds) } }, { projection: JOB_LIST_PROJECTION }).toArray()
      : [],
    missingExternalIds.length && externalScrapedJobsCollection
      ? externalScrapedJobsCollection.find({ _id: { $in: toObjectIds(missingExternalIds) } }).toArray()
      : [],
    readProjectedJobStatuses(resolvedProfileId, marketIds),
  ]);
  const docs = new Map([
    ...cardDocs.map((doc) => [String(doc._id), doc]),
    ...marketDocs.map((doc) => [String(doc._id), doc]),
    ...externalDocs.map((doc) => [String(doc._id), normalizeExternalScrapedJob(doc)]),
  ]);
  return hydratedEntries.flatMap((entry) => {
    const rawJob = docs.get(entry.jobId);
    const job = rawJob && catalogOf(entry) !== 'external'
      ? { ...rawJob, status: projectedStatuses.get(entry.jobId) || [] }
      : rawJob;
    if (!job) return [];
    const hasAi = Array.isArray(job.aiSkills) && job.aiSkills.length;
    const enriched = enrichJobSkillsFromTitle(job);
    const jobSkills = hasAi ? job.aiSkills : enriched.skills;
    const coverage = computeCoverageScore(jobSkills, profileCtx);
    const displaySkills = hasAi ? job.aiSkills.map((skill) => skill.name) : enriched.skills;
    const scores = composeJobScores({ ...job, skills: displaySkills }, coverage, { vectorScore: null });
    return [{
      ...job,
      skills: displaySkills,
      skillsNormalized: enriched.skillsNormalized,
      ...scores,
    }];
  });
}

async function filterEntriesByAuthoritativeQueries(entries, {
  marketQuery,
  externalQuery,
  includeExternal,
} = {}) {
  if (!entries.length) return [];
  const catalogOf = (entry) => entry.catalog || entry.payload?.catalog || 'market';
  const marketIds = entries.filter((entry) => catalogOf(entry) !== 'external').map((entry) => entry.jobId);
  const externalIds = entries.filter((entry) => catalogOf(entry) === 'external').map((entry) => entry.jobId);
  const [marketDocs, externalDocs] = await Promise.all([
    marketIds.length
      ? jobsCollection.find(
          { $and: [marketQuery || {}, { _id: { $in: toObjectIds(marketIds) } }] },
          { projection: { _id: 1 } },
        ).toArray()
      : [],
    includeExternal && externalIds.length && externalScrapedJobsCollection
      ? externalScrapedJobsCollection.find(
          { $and: [externalQuery || {}, { _id: { $in: toObjectIds(externalIds) } }] },
          { projection: { _id: 1 } },
        ).toArray()
      : [],
  ]);
  const accepted = new Set([...marketDocs, ...externalDocs].map((doc) => String(doc._id)));
  return entries.filter((entry) => accepted.has(entry.jobId));
}

async function countAuthoritativeJobs({ marketQuery, externalQuery, includeExternal }) {
  const [marketTotal, externalTotal] = await Promise.all([
    jobsCollection.countDocuments(marketQuery || {}),
    includeExternal && externalScrapedJobsCollection
      ? externalScrapedJobsCollection.countDocuments(externalQuery || {})
      : 0,
  ]);
  return marketTotal + externalTotal;
}

async function directStatusRanking({ mongoQuery, profileCtx, scoreFilters, limit }) {
  const docs = await jobsCollection.find(mongoQuery || {}, { projection: JOB_LIST_PROJECTION }).toArray();
  const candidates = docs.map((job) => {
    const hasAi = Array.isArray(job.aiSkills) && job.aiSkills.length;
    const aiSkills = hasAi ? job.aiSkills : enrichJobSkillsFromTitle(job).skills;
    return {
      jobId: String(job._id),
      sparseScore: 0,
      semanticRank: null,
      fusionScore: 0,
      payload: {
        catalog: 'market',
        postedAt: job.postedAt || job._createdAt || null,
        aiSkills,
      },
    };
  });
  return rerankInPool(candidates, profileCtx, scoreFilters, limit);
}

export async function listQueryTimeRankedJobs({
  applierName,
  profileId: providedProfileId = null,
  listBody,
  mongoQuery,
  scoreFilters,
  skip,
  limit,
  includeExternal = false,
  externalQuery = null,
  validationMode = false,
}) {
  const requestStarted = performance.now();
  const timings = { retrievalMs: 0, rerankMs: 0, hydrateMs: 0 };
  const serving = isQueryTimeRankingEnabled();
  const shadowValidation = validationMode && getQueryTimeRankingMode() === 'shadow';
  if (!serving && !shadowValidation) return null;
  if (!isJobRankingReady() || !isRedisReady()) {
    if (!serving) return null;
    return listDateRankedRankingFallback({
      mongoQuery, externalQuery, skip, limit, includeExternal,
    });
  }
  if (!applierName) return null;

  const profileId = providedProfileId
    ? String(providedProfileId)
    : hasPersonalStatusFilter(listBody)
      ? profileIdFromQuery(mongoQuery)
      : null;
  const [dictionary, profileVersion, catalogRevision, statusRevision] = await Promise.all([
    loadCanonicalSkillDictionary(),
    getProfileRankingVersion(applierName),
    getCatalogRevision(),
    hasPersonalStatusFilter(listBody)
      ? (profileId
          ? getStatusRevision(profileId)
          : accountInfoCollection?.findOne(
          { name: String(applierName).trim() },
          { projection: { _id: 1 } },
        ).then((account) => getStatusRevision(account?._id)) || '0')
      : '0',
  ]);
  // Tier visibility is not a client filter, but it must be part of the cache
  // identity so a beta ranking can never be reused after a tier change.
  const excludesExtensionV2 = queryExcludesExtensionV2Jobs(mongoQuery);
  const filterHash = rankingFilterHash({
    ...listBody,
    _extensionV2Visibility: excludesExtensionV2 ? 'public' : 'beta',
  });
  const cacheKey = rankingCacheKey({
    applierName,
    profileVersion,
    statusRevision,
    dictionaryVersion: dictionary.version,
    catalogRevision,
    filterHash,
  });
  let cached = await readRankingCache(cacheKey);
  incrementCounter('athens_job_ranking_cache_total', { result: cached ? 'hit' : 'miss' });
  const filter = buildJobRankingFilter(listBody, { includeExternal, mongoQuery });
  let profileCtx;

  if (!cached) {
    cached = await coalesceRankingBuild(cacheKey, async () => {
    const published = await readRankingCache(cacheKey);
    if (published) return published;
    const [loadedProfileCtx, skillDocs] = await Promise.all([
      loadProfileMatchContext(applierName),
      loadUserSkillDocs(applierName),
    ]);
    profileCtx = loadedProfileCtx;
    const profileVector = buildUserSkillSparseVector(skillDocs, dictionary.entries);
    if (!profileVector.indices.length) return null;
    const limits = getQueryTimeRankingLimits();
    const authoritativePostFilter = requiresAuthoritativeCandidateFilter(listBody);
    const catalogTotalPromise = authoritativePostFilter
      ? countAuthoritativeJobs({
          marketQuery: mongoQuery,
          externalQuery,
          includeExternal,
        })
      : countJobRankingPoints(filter);
    let entries;
    if (hasPositiveStatusFilter(listBody)) {
      const rerankStarted = performance.now();
      entries = await directStatusRanking({
        mongoQuery,
        profileCtx,
        scoreFilters,
        limit: limits.personalized,
      });
      observeHistogram('athens_job_ranking_phase_seconds', { phase: 'rerank' }, (performance.now() - rerankStarted) / 1000);
      timings.rerankMs = performance.now() - rerankStarted;
    } else {
      const denseVector = isHybridMatchEnabled()
        ? (await getProfileVector(applierName).catch(() => null))?.vector
        : null;
      const retrievalStarted = performance.now();
      const denseHits = denseVector
        ? await queryJobRankingDense(denseVector, { filter, limit: limits.dense })
        : [];
      const sparseHits = [];
      let acceptedCandidates = [];
      for (let batch = 0; batch < limits.maxRetrievalBatches; batch += 1) {
        const page = await queryJobRankingSparse(profileVector, {
          filter,
          limit: limits.sparse,
          offset: batch * limits.sparse,
        });
        sparseHits.push(...page);
        const fused = fuseCandidates(sparseHits, denseHits);
        acceptedCandidates = authoritativePostFilter
          ? await filterEntriesByAuthoritativeQueries(fused, {
              marketQuery: mongoQuery,
              externalQuery,
              includeExternal,
            })
          : fused;
        if (acceptedCandidates.length >= limits.personalized || page.length < limits.sparse) break;
      }
      observeHistogram('athens_job_ranking_phase_seconds', { phase: 'retrieval' }, (performance.now() - retrievalStarted) / 1000);
      timings.retrievalMs = performance.now() - retrievalStarted;
      const rerankStarted = performance.now();
      entries = await rerankInPool(acceptedCandidates, profileCtx, scoreFilters, limits.personalized);
      observeHistogram('athens_job_ranking_phase_seconds', { phase: 'rerank' }, (performance.now() - rerankStarted) / 1000);
      timings.rerankMs = performance.now() - rerankStarted;
    }
    entries = entries.map((entry) => ({
      jobId: entry.jobId,
      sparseScore: entry.sparseScore,
      semanticRank: entry.semanticRank,
      exactScore: entry.exactScore,
    }));
    const catalogTotal = await catalogTotalPromise;
    const hasScoreFilter = scoreFilters && Object.keys(scoreFilters).length > 0;
    const total = hasScoreFilter ? entries.length : catalogTotal;
    const built = {
      entries,
      total,
      catalogTotal,
      profileVersion,
      statusRevision,
      dictionaryVersion: dictionary.version,
      catalogRevision,
      computedAt: new Date().toISOString(),
    };
    publishRankingCache(cacheKey, built);
    return built;
    });
    if (!cached) return null;
  }

  profileCtx ||= await loadProfileMatchContext(applierName);
  let pageEntries = cached.entries.slice(skip, skip + limit);
  if (pageEntries.length < limit && cached.total > skip + pageEntries.length) {
    if (!supportsRedisDateTail(listBody)) {
      if (!serving) return null;
      return listDateRankedRankingFallback({
        mongoQuery,
        externalQuery,
        skip,
        limit,
        includeExternal,
        reason: 'ranking_partial_retrieval',
      });
    }
    const rankedCount = cached.entries.length;
    const tailOffset = Math.max(0, skip - rankedCount);
    const tail = await readDateTailPage({
      offset: tailOffset,
      limit: limit - pageEntries.length,
      includeExternal,
      excludeExtensionV2: excludesExtensionV2,
      excludedJobIds: new Set(cached.entries.map((entry) => entry.jobId)),
    });
    pageEntries = [...pageEntries, ...tail];
    if (pageEntries.length < limit && cached.total > skip + pageEntries.length) {
      if (!serving) return null;
      return listDateRankedRankingFallback({
        mongoQuery,
        externalQuery,
        skip,
        limit,
        includeExternal,
        reason: 'ranking_tail_incomplete',
      });
    }
  }
  const hydrateStarted = performance.now();
  const docs = await hydratePage(pageEntries, profileCtx, { applierName, profileId });
  timings.hydrateMs = performance.now() - hydrateStarted;
  observeHistogram('athens_job_ranking_phase_seconds', { phase: 'total' }, (performance.now() - requestStarted) / 1000);
  const rankingVersion = `${cached.profileVersion}:${cached.statusRevision ?? 0}:${cached.dictionaryVersion}:${cached.catalogRevision}`;
  return {
    docs,
    total: cached.total,
    catalogTotal: cached.catalogTotal ?? cached.total,
    recommendationFallback: false,
    recommendationWarming: false,
    recommendationMaterialized: false,
    rankingVersion,
    rankingStatus: 'fresh',
    catalogRevision: cached.catalogRevision,
    personalizedThroughRank: getQueryTimeRankingLimits().personalized,
    _candidateJobIds: cached.entries.map((entry) => entry.jobId),
    _diagnostics: pageEntries.map((entry) => ({
      jobId: entry.jobId,
      sparseScore: entry.sparseScore ?? null,
      semanticRank: entry.semanticRank ?? null,
      exactScore: entry.exactScore ?? null,
    })),
    _timings: {
      ...timings,
      totalMs: performance.now() - requestStarted,
    },
  };
}
