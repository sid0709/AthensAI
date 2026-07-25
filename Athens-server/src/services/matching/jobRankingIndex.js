import { getRedis, isRedisReady } from '../../db/redis.js';
import { JOB_MARKET_EXTENSION_VERSION_V2 } from '../../config/jobMarketSchema.js';
import { buildJobSkillSparseVector } from './canonicalSkillVectors.js';
import { upsertJobRankingPoints } from '../vectorStore/qdrantClient.js';
import { deleteJobRankingPoints } from '../vectorStore/qdrantClient.js';

const CATALOG_REVISION_KEY = 'ranking:v2:catalog-revision';
const DATE_TAIL_KEY = 'ranking:v2:date-tail';
const NO_SKILL_SPARSE_INDEX = 0;
let localCatalogRevision = '0';

function text(value) {
  return String(value ?? '').trim();
}

function isoDate(value) {
  const date = value instanceof Date ? value : new Date(value || 0);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

function stringArray(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  const single = text(value);
  return single ? [single] : [];
}

function compactJobCard(job, catalog) {
  return {
    _id: String(job?._id || job?.jobId || ''),
    catalog,
    title: job?.title,
    jobTitle: job?.jobTitle,
    company: job?.company,
    companyName: job?.companyName,
    companyIcon: job?.companyIcon,
    companyLink: job?.companyLink,
    applyLink: job?.applyLink,
    jobLink: job?.jobLink,
    source: job?.source,
    sender: job?.sender,
    postedAt: job?.postedAt,
    _createdAt: job?._createdAt,
    createdAt: job?.createdAt,
    postedAgo: job?.postedAgo,
    details: job?.details,
    tags: job?.tags,
    applicants: job?.applicants,
    skillAnalysis: job?.skillAnalysis,
    titleScanned: job?.titleScanned,
    version: job?.version,
    extensionV2: job?.extensionV2,
    aiSkillStatus: job?.aiSkillStatus,
    aiSkillExtractedAt: job?.aiSkillExtractedAt,
  };
}

const RANKING_CATEGORY_CODES = {
  hard: 0,
  devops: 1,
  tools: 2,
  domain: 3,
  soft: 4,
};

function compactRankingSkills(aiSkills) {
  return aiSkills.map((skill) => {
    const isString = typeof skill === 'string';
    return [
      String(isString ? skill : skill?.name || '').trim(),
      isString ? 0 : (RANKING_CATEGORY_CODES[skill?.category] ?? 0),
      isString ? 1 : Math.min(5, Math.max(1, Number(skill?.requirement) || 1)),
    ];
  }).filter(([name]) => name);
}

export function buildJobRankingPayload(job, { catalog = 'market' } = {}) {
  const company = job?.company && typeof job.company === 'object'
    ? job.company
    : { name: job?.companyName || '' };
  const details = job?.details && typeof job.details === 'object' ? job.details : {};
  const title = text(job?.title || job?.jobTitle);
  const postedAt = isoDate(job?.postedAt || job?._createdAt || job?.createdAt);
  const aiSkills = Array.isArray(job?.aiSkills) && job.aiSkills.length
    ? job.aiSkills
    : stringArray(job?.skills).map((name) => ({ name, category: 'hard', requirement: 1 }));

  return {
    active: job?.active !== false,
    catalog,
    title,
    companyName: text(company?.name),
    companyTags: stringArray(company?.tags),
    location: text(details?.position || job?.location),
    workMode: text(details?.remote || job?.workMode),
    seniority: stringArray(details?.seniority),
    titleRoles: stringArray(job?.titleScanned),
    source: text(job?.source) || 'Other',
    postedAt,
    extensionV2: String(job?.version || '') === JOB_MARKET_EXTENSION_VERSION_V2 || job?.extensionV2 === true,
    aiExtracted: Array.isArray(job?.aiSkills) && job.aiSkills.length > 0,
    aiSkills,
    rankSkills: compactRankingSkills(aiSkills),
    card: compactJobCard(job, catalog),
  };
}

export function buildJobRankingPoint(job, { catalog = 'market', semanticDense } = {}) {
  const payload = buildJobRankingPayload(job, { catalog });
  const sparse = buildJobSkillSparseVector(payload.aiSkills);
  return {
    jobId: String(job?._id || job?.jobId || ''),
    // Keep unextracted jobs in the searchable catalog/count and date tail.
    // Index 0 is reserved and never emitted by stableSkillId, so it cannot
    // match a real profile vector.
    skillsSparse: sparse.indices.length
      ? { indices: sparse.indices, values: sparse.values }
      : { indices: [NO_SKILL_SPARSE_INDEX], values: [1] },
    semanticDense,
    payload,
  };
}

export async function indexJobRankingBatch(jobs, {
  catalog = 'market',
  semanticVectors = new Map(),
  wait = true,
  collectionName,
} = {}) {
  const points = jobs
    .map((job) => buildJobRankingPoint(job, {
      catalog,
      semanticDense: semanticVectors.get(String(job?._id || job?.jobId || '')),
    }))
    .filter((point) => point.jobId);
  if (!points.length) return { indexed: 0, catalogRevision: await getCatalogRevision() };
  const upserted = await upsertJobRankingPoints(points, { wait, collectionName });
  if (!upserted) return { indexed: 0, catalogRevision: await getCatalogRevision() };
  if (isRedisReady()) {
    const members = points.map((point) => ({
      score: Date.parse(point.payload.postedAt) || 0,
      value: `${point.payload.catalog}:${point.jobId}`,
    }));
    if (members.length) await getRedis().zAdd(DATE_TAIL_KEY, members);
  }
  const catalogRevision = await bumpCatalogRevision();
  return { indexed: points.length, catalogRevision };
}

export async function readDateTailPage({
  offset = 0,
  limit = 25,
  includeExternal = false,
  excludedJobIds = new Set(),
} = {}) {
  if (!isRedisReady()) return [];
  const out = [];
  let accepted = 0;
  let cursor = 0;
  const chunkSize = 500;
  while (out.length < limit) {
    const values = await getRedis().zRange(DATE_TAIL_KEY, cursor, cursor + chunkSize - 1, { REV: true });
    if (!values.length) break;
    cursor += values.length;
    for (const value of values) {
      const split = value.indexOf(':');
      const catalog = split > 0 ? value.slice(0, split) : 'market';
      const jobId = split > 0 ? value.slice(split + 1) : value;
      if ((!includeExternal && catalog === 'external') || excludedJobIds.has(jobId)) continue;
      if (accepted++ < offset) continue;
      out.push({
        jobId,
        catalog,
        sparseScore: 0,
        semanticRank: null,
        exactScore: 0,
        fusionScore: 0,
      });
      if (out.length >= limit) break;
    }
    if (values.length < chunkSize) break;
  }
  return out;
}

export async function indexOneJobRanking(job, options = {}) {
  return indexJobRankingBatch([job], { ...options, wait: true });
}

export async function removeJobsFromRanking(jobIds = []) {
  const ids = jobIds.map(String).filter(Boolean);
  if (!ids.length) return { removed: 0 };
  await deleteJobRankingPoints(ids, { wait: true }).catch(() => false);
  if (isRedisReady()) {
    const members = ids.flatMap((id) => [`market:${id}`, `external:${id}`]);
    await getRedis().zRem(DATE_TAIL_KEY, members);
  }
  await bumpCatalogRevision();
  return { removed: ids.length };
}

export async function getCatalogRevision() {
  if (!isRedisReady()) return localCatalogRevision;
  const value = await getRedis().get(CATALOG_REVISION_KEY);
  if (value != null) localCatalogRevision = String(value);
  return localCatalogRevision;
}

export async function bumpCatalogRevision() {
  if (!isRedisReady()) {
    localCatalogRevision = String(Number(localCatalogRevision || 0) + 1);
    return localCatalogRevision;
  }
  localCatalogRevision = String(await getRedis().incr(CATALOG_REVISION_KEY));
  return localCatalogRevision;
}
