import { getRedis, isRedisReady } from '../../db/redis.js';
import { incrementCounter, observeHistogram, setGauge } from '../monitoring/metrics.js';
import {
	TitleReviewQueryError,
	getTitleReviewCountsNative,
	listTitleReviewJobsNative,
	normalizeTitleReviewRequest,
	scanTitleReviewQueueForSnapshot,
} from './titleReviewQueryService.js';

const SNAPSHOT_SCHEMA_VERSION = 1;
const SNAPSHOT_TTL_SECONDS = 7 * 24 * 60 * 60;
const REVISION_KEY = 'title-review:v1:revision';
const LATEST_SNAPSHOT_KEY = 'title-review:v1:snapshot:latest';
const REVISION_CHECK_TTL_MS = 500;
const DEFAULT_REBUILD_DELAY_MS = 250;
const MAX_REBUILD_CATCH_UP_ATTEMPTS = 5;

let localRevision = 1;
let revisionCache = { value: '1', expiresAt: 0 };
let currentSnapshot = null;
let snapshotBuild = null;
let rebuildTimer = null;
let lastBuildFailureAt = 0;

function snapshotKey(revision) {
	return `title-review:v1:snapshot:${String(revision)}`;
}

function text(value) {
	return String(value ?? '').trim();
}

function postedTime(row) {
	return Date.parse(row?.postedAt || 0) || 0;
}

function confidence(row) {
	const value = Number(row?.titleReview?.confidence);
	return Number.isFinite(value) ? value : -1;
}

function compareNewest(left, right) {
	return postedTime(right) - postedTime(left) || String(right.id).localeCompare(String(left.id));
}

function compareOldest(left, right) {
	return postedTime(left) - postedTime(right) || String(left.id).localeCompare(String(right.id));
}

function compareConfidence(left, right) {
	return confidence(right) - confidence(left) || compareNewest(left, right);
}

function compactRow(row) {
	return {
		id: String(row?.id || ''),
		title: String(row?.title || 'Untitled role'),
		titleLower: String(row?.title || '').toLocaleLowerCase(),
		company: String(row?.company || 'Unknown'),
		source: String(row?.source || 'Other'),
		postedAt: row?.postedAt || null,
		applyUrl: String(row?.applyUrl || ''),
		titleReview: row?.titleReview || null,
	};
}

function publicRow(row) {
	return {
		id: row.id,
		title: row.title,
		company: row.company,
		source: row.source,
		postedAt: row.postedAt,
		applyUrl: row.applyUrl,
		titleReview: row.titleReview,
	};
}

export function finalizeTitleReviewSnapshot(rows, revision, { source = 'build' } = {}) {
	const byId = new Map();
	for (const row of rows || []) {
		const compact = compactRow(row);
		if (compact.id) byId.set(compact.id, compact);
	}
	const entries = [...byId.values()];
	const unreviewedNewest = entries
		.filter((row) => ['pending', 'scanning'].includes(row.titleReview?.processingState))
		.sort(compareNewest);
	const reviewRows = entries.filter((row) => row.titleReview?.label === 'REVIEW_REQUIRED');
	const failedRows = entries.filter((row) => row.titleReview?.processingState === 'failed');
	const pending = entries.filter((row) => ['pending', 'failed'].includes(row.titleReview?.processingState)).length;
	return {
		schemaVersion: SNAPSHOT_SCHEMA_VERSION,
		revision: String(revision || '1'),
		builtAt: new Date().toISOString(),
		source,
		entries,
		byId,
		queues: {
			unreviewed: { newest: unreviewedNewest },
			review_required: {
				confidence_desc: [...reviewRows].sort(compareConfidence),
				newest: [...reviewRows].sort(compareNewest),
				oldest: [...reviewRows].sort(compareOldest),
			},
			failed: {
				newest: [...failedRows].sort(compareNewest),
				oldest: [...failedRows].sort(compareOldest),
			},
		},
		counts: {
			pending,
			unreviewedCount: unreviewedNewest.length,
			reviewRequiredCount: reviewRows.length,
			failedCount: failedRows.length,
		},
	};
}

function serializeSnapshot(snapshot) {
	return JSON.stringify({
		schemaVersion: SNAPSHOT_SCHEMA_VERSION,
		revision: snapshot.revision,
		builtAt: snapshot.builtAt,
		entries: snapshot.entries.map(publicRow),
	});
}

function parseSnapshot(raw, expectedRevision = null) {
	try {
		const parsed = JSON.parse(raw);
		if (Number(parsed?.schemaVersion) !== SNAPSHOT_SCHEMA_VERSION) return null;
		if (expectedRevision != null && String(parsed?.revision) !== String(expectedRevision)) return null;
		if (!Array.isArray(parsed?.entries)) return null;
		const snapshot = finalizeTitleReviewSnapshot(parsed.entries, parsed.revision, { source: 'redis' });
		snapshot.builtAt = parsed.builtAt || snapshot.builtAt;
		return snapshot;
	} catch {
		return null;
	}
}

export async function getTitleReviewRevision({ force = false } = {}) {
	if (!force && revisionCache.expiresAt > Date.now()) return revisionCache.value;
	if (isRedisReady()) {
		try {
			const redis = getRedis();
			let value = await redis.get(REVISION_KEY);
			if (!value) {
				await redis.set(REVISION_KEY, String(localRevision), { NX: true });
				value = await redis.get(REVISION_KEY);
			}
			if (value) localRevision = Math.max(localRevision, Number(value) || 1);
			revisionCache = { value: String(value || localRevision), expiresAt: Date.now() + REVISION_CHECK_TTL_MS };
			return revisionCache.value;
		} catch (error) {
			console.warn('[title-review] revision read failed:', error?.message || error);
		}
	}
	revisionCache = { value: String(localRevision), expiresAt: Date.now() + REVISION_CHECK_TTL_MS };
	return revisionCache.value;
}

export async function bumpTitleReviewRevision() {
	let revision;
	if (isRedisReady()) {
		try {
			revision = await getRedis().incr(REVISION_KEY);
		} catch (error) {
			console.warn('[title-review] revision increment failed:', error?.message || error);
		}
	}
	if (!Number.isFinite(Number(revision))) revision = localRevision + 1;
	localRevision = Math.max(localRevision + 1, Number(revision));
	revisionCache = { value: String(revision), expiresAt: Date.now() + REVISION_CHECK_TTL_MS };
	return String(revision);
}

async function persistSnapshot(snapshot) {
	if (!isRedisReady()) return false;
	const payload = serializeSnapshot(snapshot);
	await Promise.all([
		getRedis().setEx(snapshotKey(snapshot.revision), SNAPSHOT_TTL_SECONDS, payload),
		getRedis().setEx(LATEST_SNAPSHOT_KEY, SNAPSHOT_TTL_SECONDS, payload),
	]);
	return true;
}

async function loadSnapshotFromRedis(revision) {
	if (!isRedisReady()) return null;
	try {
		const raw = await getRedis().get(snapshotKey(revision));
		return raw ? parseSnapshot(raw, revision) : null;
	} catch (error) {
		console.warn('[title-review] Redis snapshot read failed:', error?.message || error);
		return null;
	}
}

async function exactSnapshot(revision) {
	if (currentSnapshot?.revision === String(revision)) return { snapshot: currentSnapshot, source: 'memory' };
	const redisSnapshot = await loadSnapshotFromRedis(revision);
	if (!redisSnapshot) return null;
	currentSnapshot = redisSnapshot;
	return { snapshot: redisSnapshot, source: 'redis' };
}

async function latestStaleSnapshot() {
	if (currentSnapshot) return { snapshot: currentSnapshot, source: 'memory' };
	if (!isRedisReady()) return null;
	try {
		const raw = await getRedis().get(LATEST_SNAPSHOT_KEY);
		const snapshot = raw ? parseSnapshot(raw) : null;
		if (!snapshot) return null;
		currentSnapshot = snapshot;
		return { snapshot, source: 'redis' };
	} catch (error) {
		console.warn('[title-review] latest Redis snapshot read failed:', error?.message || error);
		return null;
	}
}

function queueFor(snapshot, { tab, sort }) {
	if (tab === 'unreviewed') return snapshot.queues.unreviewed.newest;
	if (tab === 'review_required') return snapshot.queues.review_required[sort] || snapshot.queues.review_required.confidence_desc;
	return snapshot.queues.failed[sort] || snapshot.queues.failed.newest;
}

function listFromSnapshot(snapshot, options, source, timings, {
	revision = snapshot.revision,
	stale = false,
} = {}) {
	const normalized = normalizeTitleReviewRequest(options);
	const query = normalized.q.toLocaleLowerCase();
	let rows = queueFor(snapshot, normalized);
	if (query) rows = rows.filter((row) => row.titleLower.includes(query));
	const total = rows.length;
	const start = (normalized.page - 1) * normalized.limit;
	const data = rows.slice(start, start + normalized.limit).map(publicRow);
	const serializationMs = performance.now() - timings.startedAt - timings.cacheLookupMs;
	return {
		data,
		counts: snapshot.counts,
		pagination: {
			page: normalized.page,
			limit: normalized.limit,
			total,
			totalPages: Math.ceil(total / normalized.limit),
		},
		meta: {
			cacheSource: source,
			revision: String(revision),
			snapshotRevision: snapshot.revision,
			stale,
			builtAt: snapshot.builtAt,
			serverDurationMs: performance.now() - timings.startedAt,
			cacheLookupMs: timings.cacheLookupMs,
			firestoreMs: 0,
			serializationMs,
			returnedRows: data.length,
		},
	};
}

function recordListMetrics(result, tab) {
	const source = result.meta.cacheSource;
	incrementCounter('athens_title_review_requests_total', { source, tab });
	incrementCounter('athens_title_review_rows_returned_total', { source, tab }, result.data.length);
	observeHistogram('athens_title_review_request_duration_seconds', { source, tab }, result.meta.serverDurationMs / 1_000);
	setGauge('athens_title_review_snapshot_rows', {}, currentSnapshot?.entries.length || 0);
}

/** List from process memory/Redis, or use the exact indexed Firestore query while rebuilding. */
export async function listTitleReviewReadModel(options = {}) {
	const normalized = normalizeTitleReviewRequest(options);
	const timings = { startedAt: performance.now(), cacheLookupMs: 0 };
	const revision = await getTitleReviewRevision();
	const cacheStartedAt = performance.now();
	const cached = await exactSnapshot(revision);
	timings.cacheLookupMs = performance.now() - cacheStartedAt;
	if (cached) {
		const result = listFromSnapshot(cached.snapshot, normalized, cached.source, timings);
		recordListMetrics(result, normalized.tab);
		return result;
	}
	const stale = await latestStaleSnapshot();
	if (stale) {
		scheduleTitleReviewReadModelRebuild({ delayMs: 0 });
		const result = listFromSnapshot(stale.snapshot, normalized, stale.source, timings, {
			revision,
			stale: true,
		});
		recordListMetrics(result, normalized.tab);
		return result;
	}

	if (normalized.q) {
		scheduleTitleReviewReadModelRebuild({ delayMs: 0 });
		incrementCounter('athens_title_review_cache_warming_total', { tab: normalized.tab });
		throw new TitleReviewQueryError(
			'Title search is warming. Retry in a moment.',
			{ code: 'TITLE_REVIEW_CACHE_WARMING', retryAfter: 2 },
		);
	}
	let native;
	let counts;
	try {
		[native, counts] = await Promise.all([
			listTitleReviewJobsNative(normalized, { includeCount: false }),
			getTitleReviewCountsNative(),
		]);
	} finally {
		// Do not compete with the latency-sensitive indexed fallback. The full
		// snapshot starts only after this request's Firestore reads have settled.
		scheduleTitleReviewReadModelRebuild({ delayMs: DEFAULT_REBUILD_DELAY_MS });
	}
	const total = normalized.tab === 'unreviewed'
		? counts.unreviewedCount
		: normalized.tab === 'review_required'
			? counts.reviewRequiredCount
			: counts.failedCount;
	native.pagination.total = total;
	native.pagination.totalPages = Math.ceil(total / normalized.limit);
	const result = {
		data: native.data,
		counts,
		pagination: native.pagination,
		meta: {
			cacheSource: 'firestore',
			revision,
			stale: Boolean(currentSnapshot && currentSnapshot.revision !== revision),
			builtAt: currentSnapshot?.builtAt || null,
			serverDurationMs: performance.now() - timings.startedAt,
			cacheLookupMs: timings.cacheLookupMs,
			firestoreMs: native.timings.firestore,
			serializationMs: native.timings.serialization,
			returnedRows: native.data.length,
		},
	};
	recordListMetrics(result, normalized.tab);
	return result;
}

export async function getCachedTitleReviewCounts() {
	const revision = await getTitleReviewRevision();
	const cached = await exactSnapshot(revision);
	return cached?.snapshot?.counts || null;
}

/** Rebuild all compact queues with three indexed scans, then atomically publish by revision key. */
export async function rebuildTitleReviewReadModel({ force = false } = {}) {
	if (snapshotBuild) return snapshotBuild;
	let revision = await getTitleReviewRevision({ force: true });
	const existing = await exactSnapshot(revision);
	if (existing && !force) {
		return {
			revision,
			rows: existing.snapshot.entries.length,
			counts: existing.snapshot.counts,
			current: true,
			cacheSource: existing.source,
		};
	}
	const startedAt = performance.now();
	let followupRebuild = false;
	snapshotBuild = (async () => {
		const queues = {
			unreviewed: await scanTitleReviewQueueForSnapshot('unreviewed'),
			review_required: await scanTitleReviewQueueForSnapshot('review_required'),
			failed: await scanTitleReviewQueueForSnapshot('failed'),
		};
		let snapshot = null;
		for (let attempt = 0; attempt < MAX_REBUILD_CATCH_UP_ATTEMPTS; attempt += 1) {
			snapshot = finalizeTitleReviewSnapshot(Object.values(queues).flat(), revision);
			const beforeRevision = await getTitleReviewRevision({ force: true });
			const authoritativeCounts = await getTitleReviewCountsNative();
			const afterRevision = await getTitleReviewRevision({ force: true });
			const countsMatch = (
				snapshot.counts.pending === authoritativeCounts.pending
				&& snapshot.counts.unreviewedCount === authoritativeCounts.unreviewedCount
				&& snapshot.counts.reviewRequiredCount === authoritativeCounts.reviewRequiredCount
				&& snapshot.counts.failedCount === authoritativeCounts.failedCount
			);
			if (beforeRevision === afterRevision && countsMatch) {
				revision = afterRevision;
				if (snapshot.revision !== revision) {
					snapshot = finalizeTitleReviewSnapshot(Object.values(queues).flat(), revision);
				}
				await persistSnapshot(snapshot);
				currentSnapshot = snapshot;
				setGauge('athens_title_review_snapshot_rows', {}, snapshot.entries.length);
				setGauge('athens_title_review_snapshot_revision', {}, Number(revision));
				observeHistogram('athens_title_review_snapshot_build_duration_seconds', {}, (performance.now() - startedAt) / 1_000);
				return { revision, rows: snapshot.entries.length, counts: snapshot.counts, current: true, catchUpAttempts: attempt };
			}

			revision = afterRevision;
			const changedTabs = new Set();
			if (
				snapshot.counts.unreviewedCount !== authoritativeCounts.unreviewedCount
				|| snapshot.counts.pending !== authoritativeCounts.pending
			) changedTabs.add('unreviewed');
			if (snapshot.counts.reviewRequiredCount !== authoritativeCounts.reviewRequiredCount) changedTabs.add('review_required');
			if (
				snapshot.counts.failedCount !== authoritativeCounts.failedCount
				|| snapshot.counts.pending !== authoritativeCounts.pending
			) changedTabs.add('failed');
			// A revision with unchanged counts can still replace one queue member
			// with another, so fall back to all three compact scans in that rare case.
			if (!changedTabs.size) {
				changedTabs.add('unreviewed');
				changedTabs.add('review_required');
				changedTabs.add('failed');
			}
			await Promise.all([...changedTabs].map(async (tab) => {
				queues[tab] = await scanTitleReviewQueueForSnapshot(tab);
			}));
		}

		snapshot = finalizeTitleReviewSnapshot(Object.values(queues).flat(), revision);
		followupRebuild = true;
		observeHistogram('athens_title_review_snapshot_build_duration_seconds', {}, (performance.now() - startedAt) / 1_000);
		return { revision, rows: snapshot.entries.length, counts: snapshot.counts, current: false, catchUpAttempts: MAX_REBUILD_CATCH_UP_ATTEMPTS };
	})().catch((error) => {
		lastBuildFailureAt = Date.now();
		if (error?.code === 'TITLE_REVIEW_INDEX_NOT_READY') {
			incrementCounter('athens_title_review_index_not_ready_total');
		}
		throw error;
	}).finally(() => {
		snapshotBuild = null;
		if (followupRebuild) scheduleTitleReviewReadModelRebuild({ delayMs: DEFAULT_REBUILD_DELAY_MS });
	});
	return snapshotBuild;
}

export function scheduleTitleReviewReadModelRebuild({ delayMs = DEFAULT_REBUILD_DELAY_MS } = {}) {
	if (snapshotBuild || rebuildTimer) return;
	// Avoid a tight retry loop while a Firestore index is still building.
	const cooldown = Math.max(0, 5_000 - (Date.now() - lastBuildFailureAt));
	rebuildTimer = setTimeout(() => {
		rebuildTimer = null;
		void rebuildTitleReviewReadModel().catch((error) => {
			console.warn('[title-review] background snapshot rebuild failed:', error?.message || error);
		});
	}, Math.max(delayMs, cooldown));
	rebuildTimer.unref?.();
}

/** Mark classification/recovery/new-job mutations without delaying their request. */
export async function markTitleReviewReadModelChanged({ rebuild = true, delayMs } = {}) {
	const revision = await bumpTitleReviewRevision();
	if (rebuild) scheduleTitleReviewReadModelRebuild({ delayMs });
	return revision;
}

/** Patch small mutations synchronously so normal ingest never invalidates a warm queue. */
export async function patchTitleReviewReadModel({ approvedIds = [], deletedIds = [], upsertRows = [] } = {}) {
	const previousRevision = await getTitleReviewRevision({ force: true });
	const cached = await exactSnapshot(previousRevision);
	const revision = await bumpTitleReviewRevision();
	const approved = new Set(approvedIds.map(String));
	const deleted = new Set(deletedIds.map(String));
	if (!cached?.snapshot) {
		scheduleTitleReviewReadModelRebuild({ delayMs: 0 });
		return { revision, patched: false };
	}
	const rowsById = new Map(cached.snapshot.entries.flatMap((row) => {
		if (deleted.has(row.id)) return [];
		if (!approved.has(row.id)) return [[row.id, row]];
		const approvedRow = {
			...row,
			titleReview: {
				...(row.titleReview || {}),
				processingState: 'completed',
				label: 'APPROVED',
				decisionSource: 'manual',
			},
		};
		return [[approvedRow.id, approvedRow]];
	}));
	for (const row of upsertRows) {
		const compact = compactRow(row);
		if (compact.id && !deleted.has(compact.id)) rowsById.set(compact.id, compact);
	}
	currentSnapshot = finalizeTitleReviewSnapshot([...rowsById.values()], revision, { source: 'mutation' });
	void persistSnapshot(currentSnapshot).catch((error) => {
		console.warn('[title-review] patched snapshot persist failed:', error?.message || error);
		scheduleTitleReviewReadModelRebuild({ delayMs: 0 });
	});
	return { revision, patched: true };
}

export function getTitleReviewReadModelState() {
	return {
		revision: currentSnapshot?.revision || null,
		builtAt: currentSnapshot?.builtAt || null,
		rows: currentSnapshot?.entries.length || 0,
		building: Boolean(snapshotBuild || rebuildTimer),
	};
}

export const titleReviewReadModelTest = {
	compareNewest,
	compareOldest,
	compareConfidence,
	serializeSnapshot,
	parseSnapshot,
	listFromSnapshot,
	seed(snapshot) {
		currentSnapshot = snapshot;
		localRevision = Number(snapshot?.revision) || 1;
		revisionCache = { value: String(snapshot?.revision || localRevision), expiresAt: Date.now() + REVISION_CHECK_TTL_MS };
	},
	current() {
		return currentSnapshot;
	},
	reset() {
		currentSnapshot = null;
		snapshotBuild = null;
		if (rebuildTimer) clearTimeout(rebuildTimer);
		rebuildTimer = null;
		localRevision = 1;
		revisionCache = { value: '1', expiresAt: 0 };
	},
};
