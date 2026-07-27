import { getRedis, isRedisReady } from '../../db/redis.js';
import { isExtensionV2Job } from '../../config/jobMarketSchema.js';
import { buildJobSkillSparseVector } from './canonicalSkillVectors.js';
import {
  deleteJobRankingPoints,
  getJobRankingPoints,
  isJobRankingReady,
  scrollJobRankingPayloads,
  upsertJobRankingPoints,
} from '../vectorStore/qdrantClient.js';
import { deriveCompanyIdentity } from '../companyIdentity.js';

const CATALOG_REVISION_KEY = 'ranking:v2:catalog-revision';
const DATE_TAIL_KEY = 'ranking:v2:date-tail';
const PUBLIC_DATE_TAIL_KEY = 'ranking:v2:date-tail:public';
const PUBLIC_DATE_TAIL_READY_KEY = 'ranking:v2:date-tail:public-ready';
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
		companyId: job?.companyId,
		companyNameNormalized: job?.companyNameNormalized,
		companyDomain: job?.companyDomain,
		companyIdentitySource: job?.companyIdentitySource,
		companyIdentityVersion: job?.companyIdentityVersion,
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
		skills: job?.skills,
		scoreOverall: job?.scoreOverall,
		scoreSkill: job?.scoreSkill,
		matchScore: job?.matchScore,
		skillsCovered: job?.skillsCovered,
		skillsRequired: job?.skillsRequired,
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
	const companyIdentity = job?.companyId
		? {
			companyId: String(job.companyId),
			companyNameNormalized: text(job.companyNameNormalized),
			companyDomain: text(job.companyDomain),
			companyIdentitySource: text(job.companyIdentitySource),
			companyIdentityVersion: Number(job.companyIdentityVersion) || 1,
		}
		: deriveCompanyIdentity(job, { seed: job?._id || job?.jobId });

  return {
    active: job?.active !== false,
    catalog,
    title,
    companyName: text(company?.name),
		companyId: companyIdentity.companyId,
    companyTags: stringArray(company?.tags),
    location: text(details?.position || job?.location),
    workMode: text(details?.remote || job?.workMode),
		employmentType: text(details?.time || job?.employmentType),
    seniority: stringArray(details?.seniority),
    titleRoles: stringArray(job?.titleScanned),
    source: text(job?.source) || 'Other',
    postedAt,
    extensionV2: isExtensionV2Job(job),
		version: text(job?.version),
		rankingSchemaVersion: 4,
    aiExtracted: Array.isArray(job?.aiSkills) && job.aiSkills.length > 0,
    aiSkills,
    rankSkills: compactRankingSkills(aiSkills),
		card: compactJobCard({ ...job, ...companyIdentity }, catalog),
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
    const publicMembers = points
      .filter((point) => point.payload.extensionV2 !== true)
      .map((point) => ({
        score: Date.parse(point.payload.postedAt) || 0,
        value: `${point.payload.catalog}:${point.jobId}`,
      }));
    const betaOnlyMembers = points
      .filter((point) => point.payload.extensionV2 === true)
      .map((point) => `${point.payload.catalog}:${point.jobId}`);
    if (members.length) await getRedis().zAdd(DATE_TAIL_KEY, members);
    if (publicMembers.length) await getRedis().zAdd(PUBLIC_DATE_TAIL_KEY, publicMembers);
    if (betaOnlyMembers.length) await getRedis().zRem(PUBLIC_DATE_TAIL_KEY, betaOnlyMembers);
  }
  const catalogRevision = await bumpCatalogRevision();
  return { indexed: points.length, catalogRevision };
}

export async function readDateTailPage({
  offset = 0,
  limit = 25,
  includeExternal = false,
  excludeExtensionV2 = false,
  excludedJobIds = new Set(),
  direction = 'desc',
} = {}) {
  if (!isRedisReady()) return [];
  const out = [];
  let accepted = 0;
  let cursor = 0;
  const chunkSize = 500;
  const publicTailReady = excludeExtensionV2
    ? Boolean(await getRedis().exists(PUBLIC_DATE_TAIL_READY_KEY))
    : false;
  const dateTailKey = publicTailReady ? PUBLIC_DATE_TAIL_KEY : DATE_TAIL_KEY;
  while (out.length < limit) {
    const values = await getRedis().zRange(
      dateTailKey,
      cursor,
      cursor + chunkSize - 1,
      direction === 'asc' ? undefined : { REV: true },
    );
    if (!values.length) break;
    cursor += values.length;
    const candidates = [];
    for (const value of values) {
      const split = value.indexOf(':');
      const catalog = split > 0 ? value.slice(0, split) : 'market';
      const jobId = split > 0 ? value.slice(split + 1) : value;
      if ((!includeExternal && catalog === 'external') || excludedJobIds.has(jobId)) continue;
      candidates.push({ jobId, catalog });
    }
    const visibilityPayloads = excludeExtensionV2 && !publicTailReady && candidates.length
      ? await getJobRankingPoints(
          candidates.map((candidate) => candidate.jobId),
          { payloadInclude: ['jobId', 'extensionV2'] },
        ).catch(() => [])
      : [];
    const visibleCandidates = filterDateTailCandidates(
      candidates,
      visibilityPayloads,
      { excludeExtensionV2: excludeExtensionV2 && !publicTailReady },
    );
    for (const { jobId, catalog } of visibleCandidates) {
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

/**
 * Missing Qdrant payloads are hidden for non-beta users. This fails closed and
 * lets the caller fall back to the authoritative database rather than leak v2.
 */
export function filterDateTailCandidates(candidates, payloads, { excludeExtensionV2 = false } = {}) {
  if (!excludeExtensionV2) return candidates;
  const publicIds = new Set(
    payloads
      .filter((payload) => payload?.jobId && payload.extensionV2 !== true)
      .map((payload) => String(payload.jobId)),
  );
  return candidates.filter((candidate) => publicIds.has(String(candidate.jobId)));
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
    await Promise.all([
      getRedis().zRem(DATE_TAIL_KEY, members),
      getRedis().zRem(PUBLIC_DATE_TAIL_KEY, members),
    ]);
  }
  await bumpCatalogRevision();
  return { removed: ids.length };
}

export async function preparePublicDateTailRebuild() {
  if (!isRedisReady()) return false;
  await getRedis().del([PUBLIC_DATE_TAIL_READY_KEY, PUBLIC_DATE_TAIL_KEY]);
  return true;
}

export async function markPublicDateTailReady() {
  if (!isRedisReady()) return false;
  await getRedis().set(PUBLIC_DATE_TAIL_READY_KEY, '1');
  return true;
}

export async function rebuildPublicDateTailFromRankingIndex({ batchSize = 2_000 } = {}) {
  if (!isRedisReady()) throw new Error('Redis is required to rebuild the public date tail');
  if (!isJobRankingReady()) throw new Error('Qdrant ranking index is not ready');
  await preparePublicDateTailRebuild();
  let offset = null;
  let scanned = 0;
  let indexed = 0;
  do {
    const page = await scrollJobRankingPayloads({ offset, limit: batchSize });
    const members = page.payloads
      .filter((payload) => payload?.jobId && payload.extensionV2 !== true)
      .map((payload) => ({
        score: Date.parse(payload.postedAt) || 0,
        value: `${payload.catalog || 'market'}:${payload.jobId}`,
      }));
    if (members.length) await getRedis().zAdd(PUBLIC_DATE_TAIL_KEY, members);
    scanned += page.payloads.length;
    indexed += members.length;
    offset = page.nextOffset;
  } while (offset !== null && offset !== undefined);
  await markPublicDateTailReady();
  return { scanned, indexed };
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
