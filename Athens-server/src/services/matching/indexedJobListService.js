import { createHash } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { excludeExtensionV2JobsFilter } from '../../config/jobMarketSchema.js';
import { jobsCollection } from '../../db/mongo.js';
import { getRedis, isRedisReady } from '../../db/redis.js';
import { buildJobsListQuery, JOB_LIST_PROJECTION, resolveApplierContext } from '../jobListQuery.js';
import { resolveStatusTabFromBody, shouldMergeExternal } from '../externalScrapedJobsListQuery.js';
import { readMaterializedJobStatusIds, readProjectedJobStatuses } from '../jobStatusProjectionService.js';
import {
  countJobRankingPoints,
  getJobRankingPoints,
  isJobRankingReady,
  scrollJobRankingPayloads,
  toPointId,
} from '../vectorStore/qdrantClient.js';
import { buildJobRankingFilter } from './jobRankingService.js';
import { getCatalogRevision } from './jobRankingIndex.js';

const PAYLOAD_FIELDS = ['jobId', 'catalog', 'postedAt', 'title', 'version', 'extensionV2', 'rankingSchemaVersion', 'card', 'aiSkills'];
const STATUS_STATE = {
  Applied: 'applied',
  Scheduled: 'scheduled',
  Declined: 'declined',
  BidReady: 'bid-ready',
  BidCompleted: 'bid-completed',
};

function hasScoreFilters(body = {}) {
  return Object.keys(body).some((key) => key.startsWith('score') && body[key] !== '' && body[key] != null);
}

function addStatusCondition(filter, statusTab, statusIds) {
  if (!statusIds.length && statusTab === 'posted') return filter;
  const hasId = { has_id: statusIds.map(toPointId) };
  if (statusTab === 'posted') {
    return { ...filter, must_not: [...(filter.must_not || []), hasId] };
  }
  if (statusTab !== 'all') {
    return { ...filter, must: [...(filter.must || []), hasId] };
  }
  return filter;
}

async function collectOrderedPayloads(filter, { skip, limit, direction }) {
  const needed = skip + limit;
  const payloads = [];
  const seen = new Set();
  let startFrom = null;
  while (payloads.length < needed) {
    const batch = await scrollJobRankingPayloads({
      filter,
      orderBy: { key: 'postedAt', direction },
      startFrom,
      limit: Math.min(10_000, Math.max(100, needed - payloads.length + 1)),
      payloadInclude: PAYLOAD_FIELDS,
    });
    if (!batch.payloads.length) break;
    const before = payloads.length;
    for (const payload of batch.payloads) {
      const id = String(payload.jobId || '');
      if (id && !seen.has(id)) {
        seen.add(id);
        payloads.push(payload);
      }
    }
    startFrom = batch.payloads.at(-1)?.postedAt || null;
    if (payloads.length === before || batch.payloads.length < 2 || !startFrom) break;
  }
  return payloads.slice(skip, skip + limit);
}

async function collectTitleJobIds(filter) {
	const revision = await getCatalogRevision();
	const digest = createHash('sha256').update(JSON.stringify(filter)).digest('hex').slice(0, 24);
	const cacheKey = `ranking:v3:title-order:${revision}:${digest}`;
	if (isRedisReady()) {
		const cached = await getRedis().get(cacheKey);
		if (cached) {
			try { return JSON.parse(cached); } catch { /* rebuild */ }
		}
	}
  const payloads = [];
  let offset = null;
  do {
    const batch = await scrollJobRankingPayloads({
      filter,
      offset,
      limit: 10_000,
      payloadInclude: ['jobId', 'title'],
    });
    payloads.push(...batch.payloads);
    offset = batch.nextOffset;
  } while (offset != null);
	const ids = payloads.sort((left, right) =>
    String(left.title || left.card?.title || '').localeCompare(String(right.title || right.card?.title || ''), undefined, { sensitivity: 'base' }) ||
    String(right.jobId || '').localeCompare(String(left.jobId || '')),
	).map((payload) => String(payload.jobId || '')).filter(Boolean);
	if (isRedisReady()) await getRedis().setEx(cacheKey, 60 * 60, JSON.stringify(ids));
	return ids;
}

async function hydrateIndexedCards(payloads, profileId, statusTab, { excludeExtensionV2 = false } = {}) {
	let visiblePayloads = payloads;
	if (excludeExtensionV2) {
		const suspiciousIds = payloads
			.filter((payload) =>
				(payload.catalog || payload.card?.catalog || 'market') === 'market' &&
				Number(payload.rankingSchemaVersion || 0) < 3,
			)
			.map((payload) => String(payload.jobId || ''))
			.filter(Boolean);
		if (suspiciousIds.length) {
			const suspicious = new Set(suspiciousIds);
			const acceptedDocs = await jobsCollection.find({
				$and: [
					excludeExtensionV2JobsFilter(),
					{ _id: { $in: suspiciousIds.map((id) => new ObjectId(id)) } },
				],
			}, { projection: { _id: 1 } }).toArray();
			const accepted = new Set(acceptedDocs.map((doc) => String(doc._id)));
			visiblePayloads = payloads.filter((payload) => {
				const id = String(payload.jobId || '');
				return !suspicious.has(id) || accepted.has(id);
			});
		}
	}
  const ids = visiblePayloads.map((payload) => String(payload.jobId || '')).filter(Boolean);
  const cards = new Map(visiblePayloads.flatMap((payload) => {
    const id = String(payload.jobId || '');
    return id && payload.card ? [[id, { ...payload.card, _id: id, aiSkills: payload.aiSkills || [] }]] : [];
  }));
  const missing = ids.filter((id) => !cards.has(id));
  if (missing.length) {
    const objectIds = missing.map((id) => new ObjectId(id));
    const docs = await jobsCollection.find({ _id: { $in: objectIds } }, { projection: JOB_LIST_PROJECTION }).toArray();
    docs.forEach((doc) => cards.set(String(doc._id), doc));
  }
  const statusById = profileId && statusTab !== 'posted'
    ? await readProjectedJobStatuses(profileId, ids)
    : new Map();
  return ids.flatMap((id) => {
    const card = cards.get(id);
    return card ? [{ ...card, status: statusById.get(id) || [] }] : [];
  });
}

/** Qdrant-backed non-personalized sorting/filtering; never scans the job catalog. */
export async function listIndexedJobPage(body = {}) {
  if (!isJobRankingReady() || !jobsCollection || hasScoreFilters(body)) return null;
  const sort = String(body.sort || 'postedAt_desc');
  if (!['postedAt_desc', 'postedAt_asc', 'title_asc'].includes(sort)) return null;
  if (body['details.time']) return null;

  const statusTab = resolveStatusTabFromBody(body);
  const includeExternal = shouldMergeExternal(body, statusTab);
  const account = body.applierName
    ? await resolveApplierContext(String(body.applierName).trim())
    : { id: null, isBeta: false };
  if (body.applierName && !account?.id) return null;
  const profileId = account?.id ? String(account.id) : null;
  const state = STATUS_STATE[body.status];
  const statusIds = profileId && statusTab !== 'all'
    ? await readMaterializedJobStatusIds(profileId, statusTab === 'posted' ? 'any' : state)
    : [];
  if (statusTab !== 'all' && statusTab !== 'posted' && !state) return null;
	if (statusTab !== 'all' && statusTab !== 'posted' && statusIds.length === 0) {
		const page = Math.max(1, Number.parseInt(body.page, 10) || 1);
		const limit = Math.max(1, Math.min(5000, Number.parseInt(body.limit, 10) || 10));
		return { docs: [], total: 0, page, limit, state: statusTab };
	}

  const { query } = await buildJobsListQuery(body, { includePersonalStatus: false });
  let filter = buildJobRankingFilter(body, { includeExternal, mongoQuery: query });
  filter = addStatusCondition(filter, statusTab, statusIds);
  const page = Math.max(1, Number.parseInt(body.page, 10) || 1);
  const limit = Math.max(1, Math.min(5000, Number.parseInt(body.limit, 10) || 10));
  const skip = body.skip !== undefined && body.skip !== null && body.skip !== ''
    ? Math.max(0, Number.parseInt(body.skip, 10) || 0)
    : (page - 1) * limit;

  const [total, payloads] = await Promise.all([
    countJobRankingPoints(filter),
    sort === 'title_asc'
			? collectTitleJobIds(filter)
				.then((ids) => ids.slice(skip, skip + limit))
				.then(async (ids) => {
					const points = await getJobRankingPoints(ids);
					const byId = new Map(points.map((point) => [String(point.jobId || ''), point]));
					return ids.map((id) => byId.get(id)).filter(Boolean);
				})
      : collectOrderedPayloads(filter, { skip, limit, direction: sort.endsWith('_asc') ? 'asc' : 'desc' }),
  ]);
  const docs = await hydrateIndexedCards(payloads, profileId, statusTab, { excludeExtensionV2: !account?.isBeta });
  return { docs, total, page, limit, state: statusTab };
}

/** Exact status-tab counts using Qdrant payload filters plus Redis status IDs. */
export async function countIndexedJobStatuses(body = {}) {
	if (!isJobRankingReady() || !body.applierName || hasScoreFilters(body) || body['details.time']) return null;
	const account = await resolveApplierContext(String(body.applierName).trim());
	if (!account?.id) return null;
	const profileId = String(account.id);
	const includeExternal = shouldMergeExternal(body, 'all');
	const { query } = await buildJobsListQuery(body, { includePersonalStatus: false });
	const baseFilter = buildJobRankingFilter(body, { includeExternal, mongoQuery: query });
	const [anyIds, appliedIds, scheduledIds, declinedIds, bidReadyIds, bidCompletedIds] = await Promise.all([
		readMaterializedJobStatusIds(profileId, 'any'),
		readMaterializedJobStatusIds(profileId, 'applied'),
		readMaterializedJobStatusIds(profileId, 'scheduled'),
		readMaterializedJobStatusIds(profileId, 'declined'),
		readMaterializedJobStatusIds(profileId, 'bid-ready'),
		readMaterializedJobStatusIds(profileId, 'bid-completed'),
	]);
	const countState = (ids) => ids.length
		? countJobRankingPoints({ ...baseFilter, must: [...(baseFilter.must || []), { has_id: ids.map(toPointId) }] })
		: Promise.resolve(0);
	const postedFilter = anyIds.length
		? { ...baseFilter, must_not: [...(baseFilter.must_not || []), { has_id: anyIds.map(toPointId) }] }
		: baseFilter;
	const [all, posted, applied, scheduled, declined, bidReady, bidCompleted] = await Promise.all([
		countJobRankingPoints(baseFilter),
		countJobRankingPoints(postedFilter),
		countState(appliedIds),
		countState(scheduledIds),
		countState(declinedIds),
		countState(bidReadyIds),
		countState(bidCompletedIds),
	]);
	return {
		all,
		posted,
		'bid-ready': bidReady,
		'bid-completed': bidCompleted,
		applied,
		scheduled,
		declined,
	};
}
