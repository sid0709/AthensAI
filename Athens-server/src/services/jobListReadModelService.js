import { createHash } from 'node:crypto';
import { JobSource, JobSourceTitles } from '../config/jobSources.js';
import { accountInfoCollection } from '../db/dataStore.js';
import { getRedis, isRedisReady } from '../db/redis.js';
import { extractScoreFilters, resolveApplierContext } from './jobListQuery.js';
import { readMaterializedJobStatusIds } from './jobStatusProjectionService.js';
import { computeCoverageScore } from './matching/coverageScore.js';
import { getCatalogRevision } from './matching/jobRankingIndex.js';
import { getProfileRankingVersion } from './matching/matchScoreStore.js';
import { loadProfileMatchContext } from './matching/profileSkills.js';
import { getStatusRevision } from './matching/rankingCache.js';
import { isJobRankingReady, scrollJobRankingPayloads } from './vectorStore/qdrantClient.js';
import { incrementCounter, observeHistogram, setGauge } from './monitoring/metrics.js';
import { reconcileJobTitleRoleIndex } from './jobTitleScan/titleRoleIndexSync.js';
import { inferTitleScanRole } from '../config/jobTitleScanRoles.js';
import {
  emptyJobStatusBaseline,
  jobStatusBaselineCacheKey,
  serializeJobStatusBaseline,
} from './jobStatusCache.js';

// v2 guarantees every entry has a title-role facet, inferred when AI scan data
// is unavailable. Bumping this prevents Redis from restoring role-less v1 rows.
const SNAPSHOT_SCHEMA_VERSION = 2;
const SNAPSHOT_TTL_SEC = 7 * 24 * 60 * 60;
const QUERY_CACHE_MAX = 500;
const QUERY_CACHE_TTL_MS = 60_000;
const REVISION_CHECK_TTL_MS = 1_000;
const STATUS_STATES = ['applied', 'scheduled', 'declined', 'bid-ready', 'bid-completed'];
const PAYLOAD_FIELDS = [
  'jobId', 'active', 'catalog', 'postedAt', 'title', 'companyName', 'companyId', 'companyTags',
  'location', 'workMode', 'employmentType', 'seniority', 'titleRoles', 'source',
  'extensionV2', 'version', 'aiExtracted', 'aiSkills', 'card',
];

let catalogSnapshot = null;
let catalogBuild = null;
let lastCatalogRevisionCheckAt = 0;
const queryCache = new Map();
const profileStatuses = new Map();
const profileAccounts = new Map();
const profileRankings = new Map();
const profileRankingBuilds = new Map();

function formatWarmupDuration(milliseconds) {
  if (milliseconds < 1_000) return `${Math.max(0, Math.round(milliseconds))}ms`;
  const seconds = milliseconds / 1_000;
  return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
}

function enabledValue(value, fallback = true) {
  const raw = String(value ?? (fallback ? 'true' : 'false')).trim().toLowerCase();
  return !['0', 'false', 'no', 'off'].includes(raw);
}

export function isJobListV2Enabled() {
  return enabledValue(process.env.JOB_LIST_V2_ENABLED, true);
}

function text(value) {
  return String(value ?? '').trim();
}

function lower(value) {
  return text(value).toLowerCase();
}

function list(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  const single = text(value);
  return single ? [single] : [];
}

function normalizedSkill(skill) {
  if (typeof skill === 'string') {
    const name = text(skill);
    return name ? { name, category: 'hard', requirement: 1 } : null;
  }
  const name = text(skill?.name);
  if (!name) return null;
  return {
    name,
    category: text(skill?.category) || 'hard',
    requirement: Math.min(5, Math.max(1, Number(skill?.requirement) || 1)),
  };
}

function companyObject(card, payload) {
  const raw = card?.company && typeof card.company === 'object' ? card.company : {};
  return {
    name: text(raw.name || card?.companyName || payload?.companyName) || 'Unknown',
    ...(text(raw.logo || card?.companyIcon) ? { logo: text(raw.logo || card.companyIcon) } : {}),
  };
}

function buildEntry(payload) {
  if (payload?.active === false) return null;
  const card = payload?.card && typeof payload.card === 'object' ? payload.card : {};
  const jobId = text(payload?.jobId || card?._id);
  if (!jobId) return null;
  const company = companyObject(card, payload);
  const details = card?.details && typeof card.details === 'object' ? card.details : {};
  const skills = (Array.isArray(payload?.aiSkills) && payload.aiSkills.length
    ? payload.aiSkills
    : Array.isArray(card?.aiSkills) && card.aiSkills.length
      ? card.aiSkills
      : list(card?.skills)
  ).map(normalizedSkill).filter(Boolean);
  const postedAt = text(payload?.postedAt || card?.postedAt || card?._createdAt || card?.createdAt);
  const title = text(payload?.title || card?.title || card?.jobTitle) || 'Untitled role';
  const source = text(payload?.source || card?.source) || 'Other';
  const companyTags = list(payload?.companyTags).length ? list(payload.companyTags) : list(company.tags);
  const indexedTitleRoles = list(payload?.titleRoles).length
    ? list(payload.titleRoles)
    : list(card?.titleScanned);
  const titleRoles = indexedTitleRoles.length ? indexedTitleRoles : [inferTitleScanRole(title)];
  const seniority = list(payload?.seniority).length ? list(payload.seniority) : list(details.seniority);
  const location = text(payload?.location || details.position || card?.location);
  const workMode = text(payload?.workMode || details.remote || card?.workMode);
  const employmentType = text(payload?.employmentType || details.time || card?.employmentType);
  const catalog = text(payload?.catalog || card?.catalog) || 'market';
  const companyId = text(payload?.companyId || card?.companyId) || `legacy:${jobId}`;
  const cardPayload = {
    _id: jobId,
    catalog,
    companyId,
    title,
    company,
    ...(text(card?.companyLink) ? { companyLink: text(card.companyLink) } : {}),
    ...(text(card?.applyLink || card?.jobLink) ? { applyLink: text(card.applyLink || card.jobLink) } : {}),
    source,
    postedAt,
    ...(text(card?.postedAgo) ? { postedAgo: text(card.postedAgo) } : {}),
    details: {
      position: location,
      remote: workMode,
      time: employmentType,
      seniority: seniority.join(', '),
      money: text(details.money || card?.salary),
      date: text(details.date || card?.experience),
    },
    aiSkills: [...skills]
      .sort((left, right) => right.requirement - left.requirement || left.name.localeCompare(right.name))
      .slice(0, 8),
    aiSkillCount: skills.length,
    ...(Array.isArray(card?.tags) && card.tags.length ? { tags: card.tags.slice(0, 4) } : {}),
    ...(card?.applicants ? { applicants: card.applicants } : {}),
    ...(text(card?.version || payload?.version) ? { version: text(card.version || payload.version) } : {}),
  };
  return {
    id: jobId,
    catalog,
    companyId,
    title,
    titleLower: lower(title),
    companyLower: lower(company.name),
    companyTags: companyTags.map(lower),
    locationLower: lower(location),
    workModeLower: lower(workMode),
    employmentTypeLower: lower(employmentType),
    seniorityLower: seniority.map(lower),
    titleRoles,
    source,
    postedAt,
    postedTime: Date.parse(postedAt || 0) || 0,
    extensionV2: payload?.extensionV2 === true || card?.extensionV2 === true || text(card?.version || payload?.version) === 'v2',
    aiExtracted: payload?.aiExtracted === true || text(card?.aiSkillStatus) === 'extracted' || skills.length > 0,
    rankingSkills: skills,
    card: cardPayload,
  };
}

function buildSnapshot(entries, revision) {
  const valid = entries.filter(Boolean);
  const byId = new Map(valid.map((entry) => [entry.id, entry]));
  const idsByNewest = valid
    .map((entry) => entry.id)
    .sort((left, right) => {
      const a = byId.get(left);
      const b = byId.get(right);
      return (b?.postedTime || 0) - (a?.postedTime || 0) || right.localeCompare(left);
    });
  return { revision: String(revision || '0'), entries: valid, byId, idsByNewest };
}

function finalizeSnapshot(entries, revision) {
  const snapshot = buildSnapshot(entries, revision);
  snapshot.idsByOldest = [...snapshot.idsByNewest].reverse();
  snapshot.idsByTitle = [...snapshot.byId.keys()].sort((left, right) =>
    snapshot.byId.get(left).title.localeCompare(snapshot.byId.get(right).title, undefined, { sensitivity: 'base' }) ||
    left.localeCompare(right),
  );
  snapshot.loadedAt = new Date().toISOString();
  return snapshot;
}

function serializedSnapshot(snapshot) {
  return JSON.stringify({
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    revision: snapshot.revision,
    entries: snapshot.entries,
  });
}

function parsedSnapshot(raw, expectedRevision) {
  try {
    const parsed = JSON.parse(raw);
    if (Number(parsed?.schemaVersion) !== SNAPSHOT_SCHEMA_VERSION) return null;
    if (String(parsed?.revision) !== String(expectedRevision)) return null;
    if (!Array.isArray(parsed.entries)) return null;
    return finalizeSnapshot(parsed.entries, parsed.revision);
  } catch {
    return null;
  }
}

function snapshotKey(revision) {
  return `jobs:list:v2:snapshot:${String(revision)}`;
}

async function buildCatalogSnapshot(revision) {
  if (!isJobRankingReady()) throw new Error('Job ranking index is not ready');
  const payloads = [];
  let offset = null;
  do {
    const page = await scrollJobRankingPayloads({
      offset,
      limit: 5_000,
      payloadInclude: PAYLOAD_FIELDS,
    });
    payloads.push(...page.payloads);
    offset = page.nextOffset;
  } while (offset != null);
  const snapshot = finalizeSnapshot(payloads.map(buildEntry), revision);
  if (isRedisReady()) {
    await getRedis().setEx(snapshotKey(revision), SNAPSHOT_TTL_SEC, serializedSnapshot(snapshot));
  }
  return snapshot;
}

async function loadCatalogSnapshot() {
  const revision = await getCatalogRevision();
  if (isRedisReady()) {
    const cached = await getRedis().get(snapshotKey(revision));
    const parsed = cached ? parsedSnapshot(cached, revision) : null;
    if (parsed) return parsed;
  }
  return buildCatalogSnapshot(revision);
}

async function replaceCatalogSnapshot() {
  if (catalogBuild) return catalogBuild;
  catalogBuild = loadCatalogSnapshot()
    .then((snapshot) => {
      catalogSnapshot = snapshot;
      queryCache.clear();
      for (const ranking of profileRankings.values()) ranking.stale = true;
      return snapshot;
    })
    .finally(() => { catalogBuild = null; });
  return catalogBuild;
}

async function ensureCatalogCurrent() {
  if (!catalogSnapshot) return replaceCatalogSnapshot();
  if (Date.now() - lastCatalogRevisionCheckAt < REVISION_CHECK_TTL_MS) return catalogSnapshot;
  lastCatalogRevisionCheckAt = Date.now();
  const revision = await getCatalogRevision();
  if (String(revision) !== catalogSnapshot.revision && !catalogBuild) {
    void replaceCatalogSnapshot().catch((error) => {
      console.warn('[jobs-v2] catalog snapshot refresh failed:', error?.message || error);
    });
  }
  return catalogSnapshot;
}

function statusTab(body = {}) {
  if (body.applied === false || body.applied === 'false') return 'posted';
  if (!(body.applied === true || body.applied === 'true')) return 'all';
  return ({
    Applied: 'applied', Scheduled: 'scheduled', Declined: 'declined',
    BidReady: 'bid-ready', BidCompleted: 'bid-completed',
  })[body.status] || 'all';
}

async function loadProfileStatuses(applierName, account) {
  const profileId = account?.id ? String(account.id) : null;
  if (!profileId) return { profileId: null, version: '0', byJobId: new Map(), lastCheckedAt: Date.now() };
  const existing = profileStatuses.get(profileId);
  const [version, ...stateIds] = await Promise.all([
    getStatusRevision(profileId),
    ...STATUS_STATES.map((state) => readMaterializedJobStatusIds(profileId, state)),
  ]);
  const byJobId = new Map();
  STATUS_STATES.forEach((state, index) => {
    for (const jobId of stateIds[index]) byJobId.set(String(jobId), state);
  });
  const pendingByJobId = existing?.pendingByJobId || new Map();
  for (const [jobId, pendingState] of pendingByJobId) {
    const materializedState = byJobId.get(jobId) || 'posted';
    if (materializedState === pendingState) pendingByJobId.delete(jobId);
    else if (pendingState === 'posted') byJobId.delete(jobId);
    else byJobId.set(jobId, pendingState);
  }
  const value = { profileId, version, byJobId, pendingByJobId, lastCheckedAt: Date.now() };
  profileStatuses.set(profileId, value);
  return value;
}

async function ensureProfileStatuses(applierName, account) {
  const profileId = account?.id ? String(account.id) : null;
  if (!profileId) return { profileId: null, version: '0', byJobId: new Map(), lastCheckedAt: Date.now() };
  const cached = profileStatuses.get(profileId);
  if (cached?.pendingUntil > Date.now()) return cached;
  if (cached && Date.now() - cached.lastCheckedAt < REVISION_CHECK_TTL_MS) return cached;
  const version = await getStatusRevision(profileId);
  if (cached && String(version) === String(cached.version)) {
    cached.lastCheckedAt = Date.now();
    return cached;
  }
  return loadProfileStatuses(applierName, account);
}

function rankingOwner(applierName) {
  return createHash('sha256').update(String(applierName || '')).digest('hex').slice(0, 20);
}

function profileContextKey(applierName) {
  return `jobs:list:v2:profile:${rankingOwner(applierName)}`;
}

async function readProfileAccount(applierName) {
  if (!applierName) return { id: null, isBeta: false };
  const local = profileAccounts.get(applierName);
  if (local) return local;
  if (isRedisReady()) {
    const raw = await getRedis().get(profileContextKey(applierName));
    if (raw) {
      try {
        const stored = JSON.parse(raw);
        const value = { id: text(stored.id), isBeta: Boolean(stored.isBeta) };
        if (value.id) {
          profileAccounts.set(applierName, value);
          return value;
        }
      } catch {
        /* fail closed below */
      }
    }
  }
  throw new Error(`Profile read model is not ready for ${applierName}`);
}

function profileRankingKey(applierName, profileVersion, catalogRevision) {
  return `jobs:list:v2:ranking:${rankingOwner(applierName)}:${profileVersion}:${catalogRevision}`;
}

function parseRanking(raw, applierName, profileVersion, snapshot) {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.ids) || !parsed?.scores || typeof parsed.scores !== 'object') return null;
    const ids = parsed.ids.filter((id) => snapshot.byId.has(String(id))).map(String);
    return {
      applierName,
      profileVersion,
      catalogRevision: snapshot.revision,
      version: `${profileVersion}:${snapshot.revision}`,
      ids,
      scores: new Map(Object.entries(parsed.scores)),
      computedAt: parsed.computedAt || new Date().toISOString(),
      stale: false,
      lastCheckedAt: Date.now(),
    };
  } catch {
    return null;
  }
}

async function buildProfileRanking(applierName, profileVersion, snapshot) {
  const context = await loadProfileMatchContext(applierName);
  const proficiencyCache = new Map();
  const rows = snapshot.entries.map((entry) => {
    const coverage = computeCoverageScore(entry.rankingSkills, context, proficiencyCache);
    return {
      id: entry.id,
      score: coverage.matchScore,
      covered: coverage.covered.length,
      required: coverage.required,
      postedTime: entry.postedTime,
    };
  });
  rows.sort((left, right) => right.score - left.score || right.postedTime - left.postedTime || left.id.localeCompare(right.id));
  const computedAt = new Date().toISOString();
  const ranking = {
    applierName,
    profileVersion,
    catalogRevision: snapshot.revision,
    version: `${profileVersion}:${snapshot.revision}`,
    ids: rows.map((row) => row.id),
    scores: new Map(rows.map((row) => [row.id, { score: row.score, covered: row.covered, required: row.required }])),
    computedAt,
    stale: false,
    lastCheckedAt: Date.now(),
  };
  profileRankings.set(applierName, ranking);
  if (isRedisReady()) {
    await getRedis().setEx(
      profileRankingKey(applierName, profileVersion, snapshot.revision),
      SNAPSHOT_TTL_SEC,
      JSON.stringify({ ids: ranking.ids, scores: Object.fromEntries(ranking.scores), computedAt }),
    );
  }
  return ranking;
}

async function startProfileRankingBuild(applierName, profileVersion, snapshot) {
  const key = `${applierName}:${profileVersion}:${snapshot.revision}`;
  if (profileRankingBuilds.has(key)) return profileRankingBuilds.get(key);
  const promise = buildProfileRanking(applierName, profileVersion, snapshot)
    .catch((error) => {
      console.warn(`[jobs-v2] ranking build failed for ${applierName}:`, error?.message || error);
      return null;
    })
    .finally(() => profileRankingBuilds.delete(key));
  profileRankingBuilds.set(key, promise);
  return promise;
}

async function ensureProfileRanking(applierName, snapshot, { waitForBuild = false } = {}) {
  if (!applierName) return null;
  const cached = profileRankings.get(applierName);
  if (cached && Date.now() - cached.lastCheckedAt < REVISION_CHECK_TTL_MS && !cached.stale) return cached;
  const profileVersion = await getProfileRankingVersion(applierName);
  if (
    cached &&
    Number(cached.profileVersion) === Number(profileVersion) &&
    cached.catalogRevision === snapshot.revision &&
    !cached.stale
  ) {
    cached.lastCheckedAt = Date.now();
    return cached;
  }
  if (isRedisReady()) {
    const raw = await getRedis().get(profileRankingKey(applierName, profileVersion, snapshot.revision));
    const parsed = raw ? parseRanking(raw, applierName, profileVersion, snapshot) : null;
    if (parsed) {
      profileRankings.set(applierName, parsed);
      return parsed;
    }
  }
  const build = startProfileRankingBuild(applierName, profileVersion, snapshot);
  if (waitForBuild) return build;
  return cached || null;
}

function selectedSources(body) {
  const values = text(body.jobSources)
    ? text(body.jobSources).split(',').map(text).filter(Boolean)
    : JobSourceTitles;
  const known = JobSourceTitles.filter((source) => source !== 'Other');
  const all = values.includes('Other') && known.every((source) => values.includes(source));
  return all ? null : new Set(values);
}

const filterContextCache = new WeakMap();

function filterContext(body = {}) {
  if (body && typeof body === 'object') {
    const cached = filterContextCache.get(body);
    if (cached) return cached;
  }
  const value = {
    includeExternal: body.includeExternalScraped === true || body.includeExternalScraped === 'true',
    query: lower(body.q),
    company: lower(body['company.name']),
    location: lower(body['details.position']),
    remote: lower(body['details.remote']),
    employmentType: lower(body['details.time']),
    seniority: text(body['details.seniority']).split(',').map(lower).filter(Boolean),
    tags: text(body['company.tags']).split(',').map(lower).filter(Boolean),
    roles: text(body.titleScanned).split(',').map(text).filter(Boolean),
    aiExtracted: body.aiExtracted === true || body.aiExtracted === 'true',
    sources: selectedSources(body),
    from: text(body.postedAtFrom),
    to: text(body.postedAtTo),
  };
  if (body && typeof body === 'object') filterContextCache.set(body, value);
  return value;
}

function matchesEntry(entry, body, account) {
  const filters = filterContext(body);
  if (!account?.isBeta && entry.extensionV2) return false;
  if (entry.catalog === 'external' && !filters.includeExternal) return false;
  if (filters.query && !entry.titleLower.includes(filters.query)) return false;
  if (filters.company && !entry.companyLower.includes(filters.company)) return false;
  if (filters.location && !entry.locationLower.includes(filters.location)) return false;
  if (filters.remote && entry.workModeLower !== filters.remote) return false;
  if (filters.employmentType && entry.employmentTypeLower !== filters.employmentType) return false;
  if (filters.seniority.length && !filters.seniority.some((part) => entry.seniorityLower.some((value) => value.includes(part)))) return false;
  if (filters.tags.length && !filters.tags.every((tag) => entry.companyTags.some((value) => value.includes(tag)))) return false;
  if (filters.roles.length && !filters.roles.some((role) => entry.titleRoles.includes(role))) return false;
  if (filters.aiExtracted && !entry.aiExtracted) return false;
  if (filters.sources && !filters.sources.has(entry.source)) return false;
  if (filters.from && entry.postedAt.slice(0, 10) < filters.from) return false;
  if (filters.to && entry.postedAt.slice(0, 10) > filters.to) return false;
  return true;
}

function scoreMatches(score, scoreFilters) {
  for (const bounds of Object.values(scoreFilters || {})) {
    if (bounds.min != null && score < bounds.min) return false;
    if (bounds.max != null && score > bounds.max) return false;
  }
  return true;
}

function stableBody(body, { rankingVersion, catalogRevision }) {
  const ignored = new Set(['page', 'limit', 'skip', 'groupBy', 'groupByCompany', 'applied', 'status']);
  const filtered = Object.fromEntries(Object.entries(body)
    .filter(([key]) => !ignored.has(key))
    .sort(([left], [right]) => left.localeCompare(right)));
  return JSON.stringify({
    catalogRevision,
    rankingVersion: rankingVersion || null,
    body: filtered,
  });
}

function readQueryCache(key) {
  const cached = queryCache.get(key);
  if (cached?.expiresAt > Date.now()) {
    incrementCounter('athens_jobs_v2_filter_cache_total', { result: 'hit' });
    return cached.ids;
  }
  queryCache.delete(key);
  incrementCounter('athens_jobs_v2_filter_cache_total', { result: 'miss' });
  return null;
}

function writeQueryCache(key, ids) {
  queryCache.delete(key);
  queryCache.set(key, { ids, expiresAt: Date.now() + QUERY_CACHE_TTL_MS });
  while (queryCache.size > QUERY_CACHE_MAX) {
    const oldest = queryCache.keys().next().value;
    if (!oldest) break;
    queryCache.delete(oldest);
  }
}

function baseOrder(snapshot, body, ranking) {
  const sort = text(body.sort) || 'postedAt_desc';
  if (sort === 'recommended' && ranking?.ids?.length) return ranking.ids;
  if (sort === 'postedAt_asc') return snapshot.idsByOldest;
  if (sort === 'title_asc') return snapshot.idsByTitle;
  return snapshot.idsByNewest;
}

function orderedIds(snapshot, body, account, statuses, ranking) {
  const tab = statusTab(body);
  const key = stableBody(body, {
    rankingVersion: text(body.sort) === 'recommended' ? ranking?.version : null,
    catalogRevision: snapshot.revision,
  });
  let filtered = readQueryCache(key);
  if (!filtered) {
    const scoreFilters = extractScoreFilters(body);
    filtered = [];
    for (const id of baseOrder(snapshot, body, ranking)) {
      const entry = snapshot.byId.get(id);
      if (!entry || !matchesEntry(entry, body, account)) continue;
      const score = Number(ranking?.scores?.get(id)?.score ?? entry.card.scoreSkill ?? entry.card.matchScore ?? 0);
      if (!scoreMatches(score, scoreFilters)) continue;
      filtered.push(id);
    }
    writeQueryCache(key, filtered);
  }
  if (tab === 'all') return filtered;
  return filtered.filter((id) => (statuses.byJobId.get(id) || 'posted') === tab);
}

function responseCard(entry, viewerStatus, rankingScore) {
  const score = Number(rankingScore?.score ?? entry.card.scoreSkill ?? entry.card.matchScore ?? 0);
  return {
    ...entry.card,
    viewerStatus,
    scoreSkill: score,
    scoreOverall: score,
    matchScore: score,
    skillsCovered: Number(rankingScore?.covered ?? entry.card.skillsCovered ?? 0),
    skillsRequired: Number(rankingScore?.required ?? entry.card.skillsRequired ?? entry.rankingSkills.length),
  };
}

function rankingReadinessStatus(wantsRanking, ranking, catalogRevision) {
  if (!wantsRanking) return 'fresh';
  const fresh = ranking && ranking.catalogRevision === catalogRevision && !ranking.stale;
  if (fresh) return 'fresh';
  return ranking ? 'stale' : 'warming';
}

function wantsSourceFacets(body = {}) {
  return Array.isArray(body.facets) && body.facets.includes('source');
}

function buildSourceFacets(snapshot, body, account, statuses, ranking) {
  const facetBody = { ...body };
  delete facetBody.jobSources;
  delete facetBody.facets;
  const scoreFilters = extractScoreFilters(facetBody);
  const counts = new Map();
  for (const entry of snapshot.entries) {
    if ((statuses.byJobId.get(entry.id) || 'posted') !== 'posted') continue;
    if (!matchesEntry(entry, facetBody, account)) continue;
    const score = Number(ranking?.scores?.get(entry.id)?.score ?? entry.card.scoreSkill ?? entry.card.matchScore ?? 0);
    if (!scoreMatches(score, scoreFilters)) continue;
    counts.set(entry.source, (counts.get(entry.source) || 0) + 1);
  }
  const known = new Set(JobSource.map((source) => source.title));
  const configured = JobSource
    .map((source) => ({ ...source, posted: counts.get(source.title) || 0 }))
    .filter((source) => source.posted > 0);
  const unknown = [...counts.entries()]
    .filter(([title]) => !known.has(title))
    .map(([title, posted]) => ({ title, type: 'Other', posted }));
  return [...configured, ...unknown]
    .map(({ title, type, posted }) => ({ title, type, posted }))
    .sort((left, right) => right.posted - left.posted || left.title.localeCompare(right.title));
}

export async function listJobsV2(body = {}) {
  if (!isJobListV2Enabled()) return { disabled: true };
  const started = performance.now();
  const snapshot = await ensureCatalogCurrent();
  const catalogMs = performance.now() - started;
  const applierName = text(body.applierName);
  const account = await readProfileAccount(applierName);
  const statuses = await ensureProfileStatuses(applierName, account);
  const statusMs = performance.now() - started - catalogMs;
  const wantsRanking = text(body.sort) === 'recommended' || Object.keys(extractScoreFilters(body)).length > 0;
  const ranking = wantsRanking ? await ensureProfileRanking(applierName, snapshot) : profileRankings.get(applierName) || null;
  const rankingMs = performance.now() - started - catalogMs - statusMs;
  const ids = orderedIds(snapshot, body, account, statuses, ranking);
  const filterMs = performance.now() - started - catalogMs - statusMs - rankingMs;
  const page = Math.max(1, Number.parseInt(body.page, 10) || 1);
  const limit = Math.max(1, Math.min(100, Number.parseInt(body.limit, 10) || 25));
  const skip = body.skip !== undefined && body.skip !== null && body.skip !== ''
    ? Math.max(0, Number.parseInt(body.skip, 10) || 0)
    : (page - 1) * limit;
  const data = ids.slice(skip, skip + limit).flatMap((id) => {
    const entry = snapshot.byId.get(id);
    return entry ? [responseCard(entry, statuses.byJobId.get(id) || 'posted', ranking?.scores?.get(id))] : [];
  });
  const facets = wantsSourceFacets(body)
    ? { sources: buildSourceFacets(snapshot, body, account, statuses, ranking) }
    : undefined;
  const result = {
    success: true,
    data,
    ...(facets ? { facets } : {}),
    pagination: {
      unit: 'jobs',
      page,
      limit,
      total: ids.length,
      totalPages: Math.ceil(ids.length / limit),
    },
    readModelVersion: snapshot.revision,
    ranking: {
      // REST clients poll while a requested personalized ranking is warming.
      status: rankingReadinessStatus(wantsRanking, ranking, snapshot.revision),
      version: ranking?.version ?? null,
      computedAt: ranking?.computedAt ?? null,
    },
    statusOverlayVersion: statuses.version,
    beta: Boolean(account?.isBeta),
  };
  const totalMs = performance.now() - started;
  const sort = text(body.sort) || 'postedAt_desc';
  for (const [phase, durationMs] of Object.entries({ catalog: catalogMs, status: statusMs, ranking: rankingMs, filter: filterMs, total: totalMs })) {
    observeHistogram('athens_jobs_v2_phase_seconds', { phase, sort }, durationMs / 1000);
  }
  if (ranking?.computedAt) {
    setGauge('athens_jobs_v2_ranking_age_seconds', { sort }, Math.max(0, (Date.now() - Date.parse(ranking.computedAt)) / 1000));
  }
  Object.defineProperty(result, '_serverTiming', {
    enumerable: false,
    value: { catalog: catalogMs, status: statusMs, ranking: rankingMs, filter: filterMs, total: totalMs },
  });
  return result;
}

export async function countJobsV2(body = {}) {
  if (!isJobListV2Enabled()) return { disabled: true };
  const snapshot = await ensureCatalogCurrent();
  const applierName = text(body.applierName);
  const account = await readProfileAccount(applierName);
  const statuses = await ensureProfileStatuses(applierName, account);
  const needsScores = Object.keys(extractScoreFilters(body)).length > 0;
  const ranking = needsScores ? await ensureProfileRanking(applierName, snapshot) : profileRankings.get(applierName) || null;
  const scoreFilters = extractScoreFilters(body);
  const counts = {
    all: 0,
    posted: 0,
    'bid-ready': 0,
    'bid-completed': 0,
    applied: 0,
    scheduled: 0,
    declined: 0,
  };
  for (const entry of snapshot.entries) {
    if (!matchesEntry(entry, body, account)) continue;
    const score = Number(ranking?.scores?.get(entry.id)?.score ?? 0);
    if (!scoreMatches(score, scoreFilters)) continue;
    const state = statuses.byJobId.get(entry.id) || 'posted';
    counts.all += 1;
    counts[state] = (counts[state] || 0) + 1;
  }
  return { success: true, counts, warming: false, readModelVersion: snapshot.revision, statusOverlayVersion: statuses.version };
}

export function patchJobListViewerStatus({ profileId, jobId, state, version = null }) {
  const key = text(profileId);
  const cached = key ? profileStatuses.get(key) : null;
  if (!cached) return false;
  const normalizedJobId = String(jobId);
  const normalizedState = state || 'posted';
  if (normalizedState === 'posted') cached.byJobId.delete(normalizedJobId);
  else cached.byJobId.set(normalizedJobId, normalizedState);
  if (!cached.pendingByJobId) cached.pendingByJobId = new Map();
  cached.pendingByJobId.set(normalizedJobId, normalizedState);
  cached.optimisticVersion = version == null ? null : String(version);
  cached.pendingUntil = Date.now() + 30_000;
  cached.lastCheckedAt = Date.now();
  return true;
}

/** Immediately evict permanently deleted jobs from the in-process list snapshot. */
export function evictJobsFromJobListReadModel(jobIds = []) {
  if (!catalogSnapshot || !jobIds.length) return 0;
  const removed = new Set(jobIds.map(String));
  const remaining = catalogSnapshot.entries.filter((entry) => !removed.has(entry.id));
  const deletedCount = catalogSnapshot.entries.length - remaining.length;
  if (!deletedCount) return 0;
  catalogSnapshot = finalizeSnapshot(remaining, catalogSnapshot.revision);
  queryCache.clear();
  for (const ranking of profileRankings.values()) ranking.stale = true;
  return deletedCount;
}

async function warmKnownProfiles(snapshot) {
  if (!accountInfoCollection) return;
  const warmupStartedAt = Date.now();
  const accounts = await accountInfoCollection
    .find({}, { projection: { _id: 1, name: 1, tier: 1 } })
    .toArray();
  console.log(`[jobs-v2] warming status/ranking caches for ${accounts.length} profiles`);
  for (const [index, accountDoc] of accounts.entries()) {
    const profileStartedAt = Date.now();
    const applierName = text(accountDoc?.name);
    if (!applierName) continue;
    const account = await resolveApplierContext(applierName);
    profileAccounts.set(applierName, { id: String(account.id), isBeta: Boolean(account.isBeta) });
    if (isRedisReady()) {
      await getRedis().setEx(
        profileContextKey(applierName),
        SNAPSHOT_TTL_SEC,
        JSON.stringify({ id: String(account.id), isBeta: Boolean(account.isBeta) }),
      );
    }
    await loadProfileStatuses(applierName, account);
    const profileVersion = await getProfileRankingVersion(applierName);
    let rankingLoaded = false;
    if (isRedisReady()) {
      const raw = await getRedis().get(profileRankingKey(applierName, profileVersion, snapshot.revision));
      const parsed = raw ? parseRanking(raw, applierName, profileVersion, snapshot) : null;
      if (parsed) {
        profileRankings.set(applierName, parsed);
        rankingLoaded = true;
      }
    }
    if (!rankingLoaded) await startProfileRankingBuild(applierName, profileVersion, snapshot);
    const completed = index + 1;
    const profileDuration = Date.now() - profileStartedAt;
    if (profileDuration >= 1_000 || completed === accounts.length || completed % 5 === 0) {
      console.log(
        `[jobs-v2] profile cache warmup ${completed}/${accounts.length} ` +
        `(last=${formatWarmupDuration(profileDuration)}, total=${formatWarmupDuration(Date.now() - warmupStartedAt)})`,
      );
    }
  }
  console.log(
    `[jobs-v2] profile caches warm (${accounts.length} profiles, ` +
    `${formatWarmupDuration(Date.now() - warmupStartedAt)})`,
  );
}

export async function initJobListReadModel() {
  if (!isJobListV2Enabled()) return { enabled: false };
  const snapshot = await initJobListCatalogSnapshot();
  await warmKnownProfiles(snapshot);
  console.log(`[jobs-v2] read model ready (revision=${snapshot.revision}, jobs=${snapshot.entries.length})`);
  return { enabled: true, revision: snapshot.revision, jobs: snapshot.entries.length };
}

export async function initJobListCatalogSnapshot() {
  if (!isJobListV2Enabled()) return null;
  try {
    const sync = await reconcileJobTitleRoleIndex();
    if (sync.updated > 0) {
      console.log(`[jobs-v2] restored ${sync.updated} title-role index entries`);
    }
  } catch (error) {
    console.warn('[jobs-v2] title-role index reconciliation failed:', error?.message || error);
  }
  return replaceCatalogSnapshot();
}

export async function registerJobListProfile({ profileId: profileIdRaw, applierName: applierNameRaw, isBeta = false }) {
  const profileId = text(profileIdRaw);
  const applierName = text(applierNameRaw);
  if (!profileId) return false;
  if (applierName) profileAccounts.set(applierName, { id: profileId, isBeta: Boolean(isBeta) });
  profileStatuses.set(profileId, {
    profileId,
    version: '0',
    byJobId: new Map(),
    pendingByJobId: new Map(),
    lastCheckedAt: Date.now(),
  });
  if (isRedisReady()) {
    const baseline = emptyJobStatusBaseline();
    await getRedis().setEx(
      jobStatusBaselineCacheKey(profileId),
      SNAPSHOT_TTL_SEC,
      serializeJobStatusBaseline(profileId, baseline),
    );
    if (applierName) {
      await getRedis().setEx(
        profileContextKey(applierName),
        SNAPSHOT_TTL_SEC,
        JSON.stringify({ id: profileId, isBeta: Boolean(isBeta) }),
      );
    }
  }
  if (applierName && catalogSnapshot) {
    void getProfileRankingVersion(applierName)
      .then((profileVersion) => startProfileRankingBuild(applierName, profileVersion, catalogSnapshot))
      .catch((error) => console.warn(`[jobs-v2] new profile ranking failed for ${applierName}:`, error?.message || error));
  }
  return true;
}

export function getJobListReadModelState() {
  return {
    enabled: isJobListV2Enabled(),
    ready: Boolean(catalogSnapshot),
    revision: catalogSnapshot?.revision ?? null,
    jobs: catalogSnapshot?.entries?.length ?? 0,
    profiles: profileStatuses.size,
    rankings: profileRankings.size,
  };
}

export const jobListReadModelTest = {
  buildSourceFacets,
  buildEntry,
  finalizeSnapshot,
  matchesEntry,
  orderedIds,
  rankingReadinessStatus,
  responseCard,
  scoreMatches,
  statusTab,
};
