import { createHash } from 'node:crypto';
import { DocumentId } from '@nextoffer/shared/document-id';
import { jobsCollection, externalScrapedJobsCollection } from '../db/dataStore.js';
import { getRedis, isRedisReady } from '../db/redis.js';
import { deriveCompanyIdentity } from './companyIdentity.js';
import { normalizeExternalScrapedJob } from './externalScrapedJobsListQuery.js';
import { buildJobsListQuery, JOB_LIST_PROJECTION, resolveApplierContext } from './jobListQuery.js';
import { readMaterializedJobStatusIds, readProjectedJobStatuses } from './jobStatusProjectionService.js';
import { getCatalogRevision } from './matching/jobRankingIndex.js';
import { buildJobRankingFilter } from './matching/jobRankingService.js';
import { listRecommendedJobs } from './matching/matchScoreReader.js';
import { getProfileRankingVersion } from './matching/matchScoreStore.js';
import { loadProfileMatchContext } from './matching/profileSkills.js';
import { computeCoverageScore } from './matching/coverageScore.js';
import { getStatusRevision, rankingFilterHash } from './matching/rankingCache.js';
import {
  getJobRankingPoints,
  isJobRankingReady,
  scrollJobRankingPayloads,
  toPointId,
} from './vectorStore/qdrantClient.js';
import { incrementCounter, observeHistogram, setGauge } from './monitoring/metrics.js';
import { isQueryTimeRankingEnabled } from '../config/graphAndVectorConfig.js';

const DIRECTORY_TTL_SEC = Math.max(30, Number(process.env.JOB_COMPANY_GROUP_CACHE_TTL_SEC || 300));
const PREVIEW_SIZE = 2;
const MEMBER_PAGE_MAX = 10;
const PAYLOAD_FIELDS = [
  'jobId', 'catalog', 'postedAt', 'title', 'companyId', 'companyName',
  'extensionV2', 'version', 'rankingSchemaVersion', 'card', 'aiSkills',
];
const localCache = new Map();
const LOCAL_TTL_MS = 5_000;
const LOCAL_MAX = 200;

function enabled() {
  return !['0', 'false', 'no', 'off'].includes(
    String(process.env.JOB_COMPANY_GROUPING_ENABLED ?? 'true').trim().toLowerCase(),
  );
}

function publicEnabled() {
  return !['0', 'false', 'no', 'off'].includes(
    String(process.env.JOB_COMPANY_GROUPING_PUBLIC_ENABLED ?? 'true').trim().toLowerCase(),
  );
}

function statusTab(body = {}) {
  if (body.applied === false || body.applied === 'false') return 'posted';
  if (!(body.applied === true || body.applied === 'true')) return 'all';
  return ({
    Applied: 'applied',
    Scheduled: 'scheduled',
    Declined: 'declined',
    BidReady: 'bid-ready',
    BidCompleted: 'bid-completed',
  })[body.status] || 'all';
}

function statusState(body = {}) {
  return ({
    Applied: 'applied',
    Scheduled: 'scheduled',
    Declined: 'declined',
    BidReady: 'bid-ready',
    BidCompleted: 'bid-completed',
  })[body.status] || null;
}

function addStatusFilter(filter, tab, ids) {
  if (tab === 'all') return filter;
  if (tab !== 'posted' && ids.length === 0) return null;
  if (ids.length === 0) return filter;
  const hasId = { has_id: ids.map(toPointId) };
  if (tab === 'posted') return { ...filter, must_not: [...(filter.must_not || []), hasId] };
  return { ...filter, must: [...(filter.must || []), hasId] };
}

function hasScoreFilters(scoreFilters = {}) {
  return Object.keys(scoreFilters).length > 0;
}

function scoreMatches(score, scoreFilters = {}) {
  return Object.values(scoreFilters).every((bounds) =>
    (bounds.min == null || score >= bounds.min) &&
    (bounds.max == null || score <= bounds.max),
  );
}

async function filterPayloadsByScore(payloads, applierName, scoreFilters) {
  if (!hasScoreFilters(scoreFilters)) return payloads;
  const context = await loadProfileMatchContext(applierName);
  const proficiencyCache = new Map();
  return payloads.filter((payload) => {
    const skills = Array.isArray(payload.aiSkills) && payload.aiSkills.length
      ? payload.aiSkills
      : payload.card?.skills || [];
    const score = computeCoverageScore(skills, context, proficiencyCache).matchScore;
    return scoreMatches(score, scoreFilters);
  });
}

function stableKey(parts) {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 28);
}

export function companyGroupDirectoryCacheKey({
  body,
  account,
  catalogRevision,
  statusRevision,
  rankingVersion,
}) {
  return `jobs:company-groups:v1:${stableKey({
    filter: rankingFilterHash(body),
    sort: String(body.sort || 'postedAt_desc'),
    profileId: account?.id ? String(account.id) : null,
    beta: Boolean(account?.isBeta),
    catalogRevision: String(catalogRevision || '0'),
    statusRevision: String(statusRevision || '0'),
    rankingVersion: String(rankingVersion || '0'),
  })}`;
}

function readLocal(key) {
  const entry = localCache.get(key);
  if (!entry || entry.expiresAt <= Date.now()) {
    localCache.delete(key);
    return null;
  }
  return entry.value;
}

function writeLocal(key, value) {
  localCache.delete(key);
  localCache.set(key, { value, expiresAt: Date.now() + LOCAL_TTL_MS });
  while (localCache.size > LOCAL_MAX) localCache.delete(localCache.keys().next().value);
}

async function readCached(key) {
  const memory = readLocal(key);
  if (memory) return memory;
  if (!isRedisReady()) return null;
  const raw = await getRedis().get(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    writeLocal(key, parsed);
    return parsed;
  } catch {
    return null;
  }
}

async function writeCached(key, value) {
  writeLocal(key, value);
  if (isRedisReady()) await getRedis().setEx(key, DIRECTORY_TTL_SEC, JSON.stringify(value));
}

async function scrollAllPayloads(filter) {
  const payloads = [];
  let offset = null;
  const seen = new Set();
  do {
    const page = await scrollJobRankingPayloads({
      filter,
      offset,
      limit: 5_000,
      payloadInclude: PAYLOAD_FIELDS,
    });
    if (!page.payloads.length) break;
    for (const payload of page.payloads) {
      const id = String(payload.jobId || '');
      if (id && !seen.has(id)) {
        seen.add(id);
        payloads.push(payload);
      }
    }
    offset = page.nextOffset;
  } while (offset != null);
  return payloads;
}

function sortPayloads(payloads, sort) {
  const rows = [...payloads];
  if (sort === 'title_asc') {
    return rows.sort((left, right) =>
      String(left.title || left.card?.title || '').localeCompare(String(right.title || right.card?.title || ''), undefined, { sensitivity: 'base' }) ||
      String(left.jobId || '').localeCompare(String(right.jobId || '')),
    );
  }
  const direction = sort === 'postedAt_asc' ? 1 : -1;
  return rows.sort((left, right) => {
    const leftTime = Date.parse(left.postedAt || left.card?.postedAt || '') || 0;
    const rightTime = Date.parse(right.postedAt || right.card?.postedAt || '') || 0;
    return direction * (leftTime - rightTime || String(left.jobId || '').localeCompare(String(right.jobId || '')));
  });
}

function identityOf(payload) {
  const card = payload.card || {};
  if (payload.companyId || card.companyId) {
    return { companyId: String(payload.companyId || card.companyId) };
  }
  return deriveCompanyIdentity({ ...card, _id: payload.jobId }, { seed: payload.jobId });
}

function groupPayloads(payloads) {
  const groups = new Map();
  for (const payload of payloads) {
    const jobId = String(payload.jobId || '');
    if (!jobId) continue;
    const identity = identityOf(payload);
    const card = payload.card || {};
    const company = card.company && typeof card.company === 'object' ? card.company : {};
    let group = groups.get(identity.companyId);
    if (!group) {
      group = {
        companyId: identity.companyId,
        company: {
          name: String(company.name || card.companyName || payload.companyName || 'Unknown'),
          ...(company.logo ? { logo: company.logo } : {}),
          ...(card.companyLink ? { url: card.companyLink } : {}),
        },
        memberJobIds: [],
      };
      groups.set(identity.companyId, group);
    }
    group.memberJobIds.push(jobId);
  }
  return [...groups.values()];
}

function groupedPage({ groups, page, limit, beta, jobsById, totalJobs, metadata = {} }) {
  const pageGroups = groups.slice((page - 1) * limit, page * limit);
  const previewSize = beta ? PREVIEW_SIZE : 1;
  return {
    success: true,
    data: pageGroups.map((group) => {
      const visibleJobs = group.memberJobIds
        .slice(0, previewSize)
        .map((id) => jobsById.get(id))
        .filter(Boolean);
      return {
        companyId: group.companyId,
        company: group.company,
        jobs: visibleJobs,
        ...(beta ? {
          matchingJobCount: group.memberJobIds.length,
          nextMemberOffset: visibleJobs.length < group.memberJobIds.length ? visibleJobs.length : null,
        } : {}),
      };
    }),
    pagination: {
      unit: 'companies',
      total: groups.length,
      totalJobs: Number(totalJobs || 0),
      page,
      limit,
      totalPages: Math.ceil(groups.length / limit),
    },
    beta,
    ...metadata,
  };
}

function orderRecommended(payloads, rankedIds, onlyRanked) {
  if (!rankedIds?.length) return onlyRanked ? [] : payloads;
  const byId = new Map(payloads.map((payload) => [String(payload.jobId || ''), payload]));
  const ranked = rankedIds.map((id) => byId.get(String(id))).filter(Boolean);
  if (onlyRanked) return ranked;
  const rankedSet = new Set(ranked.map((payload) => String(payload.jobId || '')));
  return [...ranked, ...payloads.filter((payload) => !rankedSet.has(String(payload.jobId || '')))];
}

async function buildDirectory(body, account, filter, scoreFilters) {
  const sort = String(body.sort || 'postedAt_desc');
  let payloads = sortPayloads(await scrollAllPayloads(filter), sort);

  payloads = await filterPayloadsByScore(payloads, body.applierName, scoreFilters);

  let recommendation = null;
  if (sort === 'recommended' && body.applierName && isQueryTimeRankingEnabled()) {
    const { query, applierId } = await buildJobsListQuery(body);
    recommendation = await listRecommendedJobs({
      applierName: body.applierName,
      profileId: applierId ? String(applierId) : null,
      dataQuery: query,
      scoreFilters,
      listBody: body,
      skip: 0,
      limit: 1,
      fastFallback: async () => ({
        docs: [],
        total: payloads.length,
        catalogTotal: payloads.length,
        _candidateJobIds: [],
      }),
    });
  } else if (sort === 'recommended') {
    recommendation = {
      recommendationFallback: true,
      recommendationReason: 'ranking_backend_unavailable',
      recommendationWarming: false,
      rankingStatus: 'fallback',
    };
  }

  if (sort === 'recommended' && body.applierName) {
    payloads = orderRecommended(payloads, recommendation?._candidateJobIds || [], false);
  }

  const groups = groupPayloads(payloads);
  const distribution = new Map();
  for (const group of groups) {
    const size = group.memberJobIds.length;
    const bucket = size === 1 ? '1' : size <= 5 ? '2-5' : size <= 10 ? '6-10' : size <= 25 ? '11-25' : '26+';
    distribution.set(bucket, (distribution.get(bucket) || 0) + 1);
  }
  for (const [bucket, count] of distribution) {
    incrementCounter('athens_job_company_group_directory_groups_total', { bucket }, count);
  }
  return {
    groups,
    totalJobs: payloads.length,
    computedAt: new Date().toISOString(),
    beta: Boolean(account?.isBeta),
    recommendationFallback: Boolean(recommendation?.recommendationFallback),
    recommendationReason: recommendation?.recommendationReason ?? null,
    recommendationWarming: Boolean(recommendation?.recommendationWarming),
    rankingVersion: recommendation?.rankingVersion ?? null,
    rankingStatus: recommendation?.rankingStatus ?? null,
  };
}

async function resolveDirectory(body) {
	const listBody = { ...body };
	for (const key of ['groupBy', 'groupByCompany', 'companyId', 'memberOffset', 'memberLimit']) delete listBody[key];
  if (!enabled()) return { disabled: true };
  if (!isJobRankingReady()) return { unavailable: true };
  const started = performance.now();
  const account = listBody.applierName
		? await resolveApplierContext(String(listBody.applierName).trim())
    : { id: null, isBeta: false };
  if (!account?.isBeta && !publicEnabled()) return { disabled: true };
  const profileId = account?.id ? String(account.id) : null;
  const tab = statusTab(listBody);
  const state = statusState(listBody);
  const statusIds = profileId && tab !== 'all'
    ? await readMaterializedJobStatusIds(profileId, tab === 'posted' ? 'any' : state)
    : [];
  const { query, scoreFilters } = await buildJobsListQuery(listBody, { includePersonalStatus: false });
  let filter = buildJobRankingFilter(listBody, { includeExternal: false, dataQuery: query });
  filter = addStatusFilter(filter, tab, statusIds);
  if (!filter) return { account, profileId, directory: { groups: [], totalJobs: 0 } };

  const [catalogRevision, statusRevision, rankingVersion] = await Promise.all([
    getCatalogRevision(),
    profileId ? getStatusRevision(profileId) : Promise.resolve('0'),
    listBody.applierName ? getProfileRankingVersion(listBody.applierName) : Promise.resolve(0),
  ]);
  const key = companyGroupDirectoryCacheKey({ body: listBody, account, catalogRevision, statusRevision, rankingVersion });
  const cached = await readCached(key);
  if (cached) {
    incrementCounter('athens_job_company_group_cache_total', { result: 'hit' });
    return { account, profileId, key, directory: cached };
  }
  incrementCounter('athens_job_company_group_cache_total', { result: 'miss' });
  const directory = await buildDirectory(listBody, account, filter, scoreFilters);
  await writeCached(key, directory);
  observeHistogram('athens_job_company_group_build_seconds', {}, (performance.now() - started) / 1000);
  return { account, profileId, key, directory };
}

function toDatabaseIds(ids) {
  return ids.map((id) => DocumentId.isValid(id) ? new DocumentId(id) : id);
}

async function hydrateJobs(ids, profileId) {
  if (!ids.length) return [];
  const payloads = await getJobRankingPoints(ids, { payloadInclude: PAYLOAD_FIELDS });
  const byId = new Map(payloads.flatMap((payload) => {
    const id = String(payload.jobId || '');
    if (!id || !payload.card) return [];
    return [[id, {
      ...payload.card,
      _id: id,
      companyId: payload.companyId || payload.card.companyId,
      aiSkills: payload.aiSkills || [],
      catalog: payload.catalog || payload.card.catalog || 'market',
    }]];
  }));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length) {
    const [marketDocs, externalDocs] = await Promise.all([
      jobsCollection.find({ _id: { $in: toDatabaseIds(missing) } }, { projection: JOB_LIST_PROJECTION }).toArray(),
      externalScrapedJobsCollection
        ? externalScrapedJobsCollection.find({ _id: { $in: toDatabaseIds(missing) } }).toArray()
        : [],
    ]);
    marketDocs.forEach((doc) => byId.set(String(doc._id), doc));
    externalDocs.forEach((doc) => byId.set(String(doc._id), normalizeExternalScrapedJob(doc)));
  }
  const statuses = profileId ? await readProjectedJobStatuses(profileId, ids) : new Map();
  return ids.flatMap((id) => {
    const job = byId.get(id);
    if (!job) return [];
    const identity = job.companyId ? null : deriveCompanyIdentity(job, { seed: id });
    return [{ ...job, ...(identity || {}), status: statuses.get(id) || job.status || [] }];
  });
}

export async function listCompanyGroupedJobs(body = {}) {
  const resolved = await resolveDirectory(body);
  if (resolved.disabled || resolved.unavailable) return resolved;
  const page = Math.max(1, Number.parseInt(body.page, 10) || 1);
  const limit = Math.max(1, Math.min(100, Number.parseInt(body.limit, 10) || 25));
  const groups = resolved.directory.groups || [];
  const pageGroups = groups.slice((page - 1) * limit, page * limit);
  const previewSize = resolved.account?.isBeta ? PREVIEW_SIZE : 1;
  const previewIds = pageGroups.flatMap((group) => group.memberJobIds.slice(0, previewSize));
  const jobs = await hydrateJobs(previewIds, resolved.profileId);
  const byId = new Map(jobs.map((job) => [String(job._id), job]));
  const response = groupedPage({
    groups,
    page,
    limit,
    beta: Boolean(resolved.account?.isBeta),
    jobsById: byId,
    totalJobs: resolved.directory.totalJobs,
    metadata: {
    recommendationFallback: Boolean(resolved.directory.recommendationFallback),
    recommendationReason: resolved.directory.recommendationReason ?? null,
    recommendationWarming: Boolean(resolved.directory.recommendationWarming),
    rankingVersion: resolved.directory.rankingVersion ?? null,
    rankingStatus: resolved.directory.rankingStatus ?? null,
    },
  });
  setGauge('athens_job_company_group_response_bytes', {
    tier: resolved.account?.isBeta ? 'beta' : 'public',
  }, Buffer.byteLength(JSON.stringify(response)));
  return response;
}

export async function listCompanyGroupMembers(body = {}) {
  const resolved = await resolveDirectory(body);
  if (resolved.disabled || resolved.unavailable) return resolved;
  if (!resolved.account?.isBeta) return { forbidden: true };
  const companyId = String(body.companyId || '').trim();
  const group = resolved.directory.groups?.find((candidate) => candidate.companyId === companyId);
  if (!group) return { notFound: true };
  const offset = Math.max(0, Number.parseInt(body.memberOffset ?? body.offset, 10) || 0);
  const limit = Math.max(1, Math.min(MEMBER_PAGE_MAX, Number.parseInt(body.memberLimit ?? body.limit, 10) || MEMBER_PAGE_MAX));
  const ids = group.memberJobIds.slice(offset, offset + limit);
  const jobs = await hydrateJobs(ids, resolved.profileId);
  return {
    success: true,
    data: jobs,
    pagination: {
      offset,
      limit,
      total: group.memberJobIds.length,
      nextOffset: offset + jobs.length < group.memberJobIds.length ? offset + jobs.length : null,
    },
  };
}

export const companyGroupedJobsTest = {
  addStatusFilter,
  groupedPage,
  groupPayloads,
  orderRecommended,
  scoreMatches,
  sortPayloads,
  statusTab,
};
