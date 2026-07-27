import crypto from 'crypto';
import {
	JOB_VECTORS_COLLECTION,
	JOB_RANKINGS_COLLECTION,
	JOB_RANKINGS_ALIAS,
	RESUME_VECTORS_COLLECTION,
	getVectorDimensions,
} from './collections.js';
import {
	getQdrantApiKey,
	getQdrantUrl,
} from '../../config/graphAndVectorConfig.js';

let collectionsReady = false;
let rankingCollectionReady = false;

export function isQdrantConfigured() {
	return Boolean(getQdrantUrl());
}

function baseUrl() {
	return getQdrantUrl().replace(/\/$/, '');
}

async function qdrantFetch(path, { method = 'GET', body } = {}) {
	const url = `${baseUrl()}${path}`;
	const headers = { 'Content-Type': 'application/json' };
	const apiKey = getQdrantApiKey();
	const configuredTimeout = Number.parseInt(String(process.env.QDRANT_REQUEST_TIMEOUT_MS || ''), 10);
	const timeoutMs = Number.isFinite(configuredTimeout)
		? Math.max(250, Math.min(60_000, configuredTimeout))
		: 10_000;
	if (apiKey) {
		headers['api-key'] = apiKey;
	}

	const res = await fetch(url, {
		method,
		headers,
		body: body !== undefined ? JSON.stringify(body) : undefined,
		signal: AbortSignal.timeout(timeoutMs),
	});

	if (!res.ok) {
		const errText = await res.text().catch(() => '');
		throw new Error(`Qdrant ${method} ${path} → ${res.status}: ${errText.slice(0, 300)}`);
	}

	if (res.status === 204) return null;
	return res.json();
}

/** Deterministic UUID from a document id string for Qdrant point ids. */
export function toPointId(documentId) {
	const hash = crypto.createHash('sha256').update(String(documentId)).digest('hex');
	return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

async function ensureCollection(name) {
	if (!isQdrantConfigured()) return false;

	const dim = getVectorDimensions();
	const list = await qdrantFetch('/collections');
	const exists = list?.result?.collections?.some((c) => c.name === name);
	if (!exists) {
		await qdrantFetch(`/collections/${encodeURIComponent(name)}`, {
			method: 'PUT',
			body: {
				vectors: { size: dim, distance: 'Cosine' },
			},
		});
	}
	return true;
}

async function ensureRankingCollection(collectionName = JOB_RANKINGS_COLLECTION, { ensureAlias = true } = {}) {
	if (!isQdrantConfigured()) return false;
	const list = await qdrantFetch('/collections');
	const exists = list?.result?.collections?.some((c) => c.name === collectionName);
	if (!exists) {
		try {
			await qdrantFetch(`/collections/${encodeURIComponent(collectionName)}`, {
				method: 'PUT',
				body: {
					vectors: {
						semantic_dense: { size: getVectorDimensions(), distance: 'Cosine' },
					},
					sparse_vectors: {
						skills_sparse: { index: { on_disk: false } },
					},
				},
			});
		} catch (error) {
			if (!String(error?.message || error).includes('already exists')) throw error;
		}
	}

	if (ensureAlias) {
		const aliases = await qdrantFetch('/aliases');
		const active = aliases?.result?.aliases?.find((alias) => alias.alias_name === JOB_RANKINGS_ALIAS);
		if (!active) {
			try {
				await qdrantFetch('/collections/aliases', {
					method: 'POST',
					body: { actions: [{ create_alias: { collection_name: collectionName, alias_name: JOB_RANKINGS_ALIAS } }] },
				});
			} catch (error) {
				const refreshed = await qdrantFetch('/aliases');
				const created = refreshed?.result?.aliases?.some((alias) => alias.alias_name === JOB_RANKINGS_ALIAS);
				if (!created) throw error;
			}
		}
	}
	return true;
}

export async function initQdrantCollections() {
	if (!isQdrantConfigured()) {
		console.warn('[qdrant] QDRANT_URL not set — vector recommendations disabled');
		return false;
	}
	try {
		await ensureCollection(JOB_VECTORS_COLLECTION);
		await ensureCollection(RESUME_VECTORS_COLLECTION);
		await ensureJobPayloadIndexes();
		collectionsReady = true;
		console.log('[qdrant] collections ready');
		return true;
	} catch (err) {
		const url = getQdrantUrl() || '(not set)';
		console.error(
			`[qdrant] init failed: ${err.message}. `
			+ `Is Qdrant running at ${url}? Try: cd Athens-server && npm run qdrant:start`,
		);
		return false;
	}
}

const RANKING_PAYLOAD_INDEXES = [
	{ field_name: 'active', field_schema: 'bool' },
	{ field_name: 'catalog', field_schema: 'keyword' },
	{ field_name: 'source', field_schema: 'keyword' },
	{ field_name: 'postedAt', field_schema: 'datetime' },
	{ field_name: 'workMode', field_schema: 'keyword' },
	{ field_name: 'employmentType', field_schema: 'keyword' },
	{ field_name: 'seniority', field_schema: 'keyword' },
	{ field_name: 'titleRoles', field_schema: 'keyword' },
	{ field_name: 'extensionV2', field_schema: 'bool' },
	{ field_name: 'version', field_schema: 'keyword' },
	{ field_name: 'title', field_schema: 'text' },
	{ field_name: 'companyName', field_schema: 'text' },
	{ field_name: 'companyId', field_schema: 'keyword' },
	{ field_name: 'location', field_schema: 'text' },
	{ field_name: 'companyTags', field_schema: 'keyword' },
	{ field_name: 'aiExtracted', field_schema: 'bool' },
];

export async function initJobRankingCollection({
	collectionName = JOB_RANKINGS_COLLECTION,
	ensureAlias = true,
} = {}) {
	if (!isQdrantConfigured()) return false;
	try {
		await ensureRankingCollection(collectionName, { ensureAlias });
		const collection = await qdrantFetch(`/collections/${encodeURIComponent(collectionName)}`);
		const payloadSchema = collection?.result?.payload_schema || {};
		const missingIndexes = RANKING_PAYLOAD_INDEXES.filter((index) => !payloadSchema[index.field_name]);
		for (const index of missingIndexes) {
			try {
				await qdrantFetch(`/collections/${encodeURIComponent(collectionName)}/index?wait=true`, {
					method: 'PUT',
					body: index,
				});
			} catch (error) {
				if (!String(error?.message || error).includes('already exists')) throw error;
			}
		}
		rankingCollectionReady = true;
		return true;
	} catch (error) {
		rankingCollectionReady = false;
		console.warn('[qdrant] query-time ranking index unavailable:', error?.message || error);
		return false;
	}
}

export async function activateJobRankingCollection(collectionName = JOB_RANKINGS_COLLECTION) {
	if (!isQdrantConfigured()) throw new Error('QDRANT_URL not set');
	const aliases = await qdrantFetch('/aliases');
	const active = aliases?.result?.aliases?.find((alias) => alias.alias_name === JOB_RANKINGS_ALIAS);
	if (active?.collection_name === collectionName) return false;
	const actions = [];
	if (active) actions.push({ delete_alias: { alias_name: JOB_RANKINGS_ALIAS } });
	actions.push({ create_alias: { collection_name: collectionName, alias_name: JOB_RANKINGS_ALIAS } });
	await qdrantFetch('/collections/aliases', { method: 'POST', body: { actions } });
	return true;
}

export function isJobRankingReady() {
	return rankingCollectionReady && isQdrantConfigured();
}

/** Payload indexes for pre-filtering job vectors (source, postedAt). */
async function ensureJobPayloadIndexes() {
	if (!isQdrantConfigured()) return;
	const indexes = [
		{ field_name: 'source', field_schema: 'keyword' },
		{ field_name: 'postedAt', field_schema: 'keyword' },
	];
	const collection = await qdrantFetch(`/collections/${encodeURIComponent(JOB_VECTORS_COLLECTION)}`);
	const payloadSchema = collection?.result?.payload_schema || {};
	for (const index of indexes.filter((candidate) => !payloadSchema[candidate.field_name])) {
		try {
			await qdrantFetch(
				`/collections/${encodeURIComponent(JOB_VECTORS_COLLECTION)}/index`,
				{ method: 'PUT', body: index },
			);
		} catch (err) {
			const msg = String(err.message || err);
			if (!msg.includes('already exists')) {
				console.warn(`[qdrant] payload index ${index.field_name}:`, msg);
			}
		}
	}
}

export function isQdrantReady() {
	return collectionsReady && isQdrantConfigured();
}

/** Drop and recreate the job vectors collection (maintenance / reset). */
export async function deleteJobVectorsCollection() {
	if (!isQdrantConfigured()) throw new Error('QDRANT_URL not set');
	try {
		await qdrantFetch(`/collections/${encodeURIComponent(JOB_VECTORS_COLLECTION)}`, {
			method: 'DELETE',
		});
	} catch (err) {
		const msg = String(err.message || err);
		if (!msg.includes('404') && !msg.includes('Not found')) throw err;
	}
	collectionsReady = false;
}

export async function upsertJobVector(jobId, vector, payload = {}) {
	if (!isQdrantReady()) return false;

	await qdrantFetch(`/collections/${encodeURIComponent(JOB_VECTORS_COLLECTION)}/points?wait=true`, {
		method: 'PUT',
		body: {
			points: [{
				id: toPointId(jobId),
				vector,
				payload: { jobId: String(jobId), ...payload },
			}],
		},
	});
	return true;
}

export async function getJobVectors(jobIds = []) {
	if (!isQdrantReady() || !jobIds.length) return new Map();
	const data = await qdrantFetch(`/collections/${encodeURIComponent(JOB_VECTORS_COLLECTION)}/points`, {
		method: 'POST',
		body: {
			ids: jobIds.map(toPointId),
			with_payload: true,
			with_vector: true,
		},
	});
	return new Map((data?.result || []).flatMap((point) => {
		const jobId = point.payload?.jobId;
		return jobId && Array.isArray(point.vector) ? [[String(jobId), point.vector]] : [];
	}));
}

export async function upsertJobRankingPoints(points = [], {
	wait = false,
	collectionName = JOB_RANKINGS_ALIAS,
} = {}) {
	if (!isJobRankingReady() || !points.length) return false;
	// Qdrant upsert replaces all named vectors on an existing point. Preserve a
	// previously generated dense vector when a later skill/payload update only
	// supplies the sparse vector.
	const pointIds = points.map((point) => toPointId(point.jobId));
	const existing = await qdrantFetch(`/collections/${encodeURIComponent(collectionName)}/points`, {
		method: 'POST',
		body: {
			ids: pointIds,
			with_payload: false,
			with_vector: ['semantic_dense'],
		},
	});
	const denseByPointId = new Map(
		(existing?.result || []).map((point) => [String(point.id), point.vector?.semantic_dense]),
	);
	await qdrantFetch(`/collections/${encodeURIComponent(collectionName)}/points?wait=${wait ? 'true' : 'false'}`, {
		method: 'PUT',
		body: {
			points: points.map((point) => {
				const id = toPointId(point.jobId);
				const semanticDense = Array.isArray(point.semanticDense) && point.semanticDense.length
					? point.semanticDense
					: denseByPointId.get(id);
				return {
				id,
				vector: {
					skills_sparse: point.skillsSparse,
					...(Array.isArray(semanticDense) && semanticDense.length
						? { semantic_dense: semanticDense }
						: {}),
				},
				payload: { ...point.payload, jobId: String(point.jobId) },
			};
			}),
		},
	});
	return true;
}

export async function queryJobRankingSparse(vector, { filter, limit = 2000, offset = 0 } = {}) {
	if (!isJobRankingReady() || !vector?.indices?.length) return [];
	const data = await qdrantFetch(`/collections/${encodeURIComponent(JOB_RANKINGS_ALIAS)}/points/query`, {
		method: 'POST',
		body: {
			query: vector,
			using: 'skills_sparse',
			filter,
			limit,
			offset,
			with_payload: { include: ['jobId', 'catalog', 'postedAt', 'rankSkills'] },
			with_vector: false,
		},
	});
	return (data?.result?.points || []).map((hit) => ({
		jobId: hit.payload?.jobId || null,
		score: Number(hit.score) || 0,
		payload: hit.payload || {},
	}));
}

export async function queryJobRankingDense(vector, { filter, limit = 500 } = {}) {
	if (!isJobRankingReady() || !Array.isArray(vector) || !vector.length || limit <= 0) return [];
	const data = await qdrantFetch(`/collections/${encodeURIComponent(JOB_RANKINGS_ALIAS)}/points/query`, {
		method: 'POST',
		body: {
			query: vector,
			using: 'semantic_dense',
			filter,
			limit,
			with_payload: { include: ['jobId', 'catalog', 'postedAt', 'rankSkills'] },
			with_vector: false,
		},
	});
	return (data?.result?.points || []).map((hit) => ({
		jobId: hit.payload?.jobId || null,
		score: Number(hit.score) || 0,
		payload: hit.payload || {},
	}));
}

export async function getJobRankingPoints(jobIds = [], { payloadInclude = null } = {}) {
	if (!isJobRankingReady() || !jobIds.length) return [];
	const data = await qdrantFetch(`/collections/${encodeURIComponent(JOB_RANKINGS_ALIAS)}/points`, {
		method: 'POST',
		body: {
			ids: jobIds.map(toPointId),
			with_payload: Array.isArray(payloadInclude) && payloadInclude.length
				? { include: payloadInclude }
				: true,
			with_vector: false,
		},
	});
	return (data?.result || []).map((point) => point.payload || {});
}

export async function scrollJobRankingPayloads({
	offset = null,
	limit = 1_000,
	payloadInclude = ['jobId', 'catalog', 'postedAt', 'extensionV2'],
	filter = null,
	orderBy = null,
	startFrom = null,
} = {}) {
	if (!isJobRankingReady()) return { payloads: [], nextOffset: null };
	const body = {
		limit: Math.max(1, Math.min(10_000, Number(limit) || 1_000)),
		with_payload: Array.isArray(payloadInclude) && payloadInclude.length
			? { include: payloadInclude }
			: true,
		with_vector: false,
	};
	if (filter) body.filter = filter;
	if (orderBy?.key) {
		body.order_by = {
			key: orderBy.key,
			direction: orderBy.direction === 'asc' ? 'asc' : 'desc',
			...(startFrom !== null && startFrom !== undefined ? { start_from: startFrom } : {}),
		};
	}
	if (offset !== null && offset !== undefined) body.offset = offset;
	const data = await qdrantFetch(`/collections/${encodeURIComponent(JOB_RANKINGS_ALIAS)}/points/scroll`, {
		method: 'POST',
		body,
	});
	return {
		payloads: (data?.result?.points || []).map((point) => ({
			...(point.payload || {}),
			_qdrantOrderValue: point.order_value ?? null,
		})),
		nextOffset: data?.result?.next_page_offset ?? null,
	};
}

export async function deleteJobRankingPoints(jobIds = [], { wait = false } = {}) {
	if (!isJobRankingReady() || !jobIds.length) return false;
	await qdrantFetch(`/collections/${encodeURIComponent(JOB_RANKINGS_ALIAS)}/points/delete?wait=${wait ? 'true' : 'false'}`, {
		method: 'POST',
		body: { points: jobIds.map(toPointId) },
	});
	return true;
}

export async function countJobRankingPoints(filter, { collectionName = JOB_RANKINGS_ALIAS } = {}) {
	if (!isJobRankingReady()) return 0;
	const data = await qdrantFetch(`/collections/${encodeURIComponent(collectionName)}/points/count`, {
		method: 'POST',
		body: { filter, exact: true },
	});
	return data?.result?.count ?? 0;
}

export async function upsertResumeVector(resumeId, vector, payload = {}) {
	if (!isQdrantReady()) return false;

	await qdrantFetch(`/collections/${encodeURIComponent(RESUME_VECTORS_COLLECTION)}/points?wait=true`, {
		method: 'PUT',
		body: {
			points: [{
				id: toPointId(resumeId),
				vector,
				payload: { resumeId: String(resumeId), ...payload },
			}],
		},
	});
	return true;
}

export async function deleteResumeVector(resumeId) {
	if (!isQdrantReady()) return false;
	try {
		await qdrantFetch(`/collections/${encodeURIComponent(RESUME_VECTORS_COLLECTION)}/points/delete?wait=true`, {
			method: 'POST',
			body: { points: [toPointId(resumeId)] },
		});
	} catch {
		// Point may not exist
	}
	return true;
}

export async function deleteJobVector(jobId) {
	if (!isQdrantReady()) return false;
	try {
		await qdrantFetch(`/collections/${encodeURIComponent(JOB_VECTORS_COLLECTION)}/points/delete?wait=true`, {
			method: 'POST',
			body: { points: [toPointId(jobId)] },
		});
	} catch {
		// Point may not exist
	}
	return true;
}

export async function searchJobVectors(queryVector, options = {}) {
	if (!isQdrantReady() || !queryVector?.length) return [];

	const limit = Number(options.limit) || 200;
	const offset = Math.max(0, Number(options.offset) || 0);
	const body = {
		vector: queryVector,
		limit,
		offset,
		with_payload: true,
	};
	if (options.filter) body.filter = options.filter;
	if (options.scoreThreshold !== undefined && options.scoreThreshold !== null) {
		body.score_threshold = options.scoreThreshold;
	}

	const data = await qdrantFetch(`/collections/${encodeURIComponent(JOB_VECTORS_COLLECTION)}/points/search`, {
		method: 'POST',
		body,
	});

	return (data?.result || []).map((hit) => ({
		jobId: hit.payload?.jobId || null,
		score: hit.score ?? 0,
		payload: hit.payload || {},
	}));
}

/** Count job vectors matching an optional Qdrant filter. */
export async function countJobVectors(filter) {
	if (!isQdrantReady()) return 0;
	const body = filter ? { filter, exact: true } : { exact: true };
	const data = await qdrantFetch(
		`/collections/${encodeURIComponent(JOB_VECTORS_COLLECTION)}/points/count`,
		{ method: 'POST', body },
	);
	return data?.result?.count ?? 0;
}

export async function getResumeVector(resumeId) {
	if (!isQdrantReady()) return null;

	const data = await qdrantFetch(`/collections/${encodeURIComponent(RESUME_VECTORS_COLLECTION)}/points`, {
		method: 'POST',
		body: {
			ids: [toPointId(resumeId)],
			with_vector: true,
			with_payload: true,
		},
	});

	const point = data?.result?.[0];
	if (!point?.vector) return null;
	return { vector: point.vector, payload: point.payload || {} };
}

export async function getJobVector(jobId) {
	if (!isQdrantReady()) return null;

	const data = await qdrantFetch(`/collections/${encodeURIComponent(JOB_VECTORS_COLLECTION)}/points`, {
		method: 'POST',
		body: {
			ids: [toPointId(jobId)],
			with_vector: true,
			with_payload: true,
		},
	});

	const point = data?.result?.[0];
	if (!point?.vector) return null;
	return { vector: point.vector, payload: point.payload || {} };
}

export function profilePointId(ownerName) {
	return toPointId(`profile:${String(ownerName || '').trim()}`);
}

export async function upsertProfileVector(ownerName, vector, payload = {}) {
	if (!isQdrantReady()) return false;

	const name = String(ownerName || '').trim();
	await qdrantFetch(`/collections/${encodeURIComponent(RESUME_VECTORS_COLLECTION)}/points?wait=true`, {
		method: 'PUT',
		body: {
			points: [{
				id: profilePointId(name),
				vector,
				payload: {
					ownerName: name,
					resumeId: '__profile__',
					kind: 'profile',
					...payload,
				},
			}],
		},
	});
	return true;
}

export async function getProfileVector(ownerName) {
	if (!isQdrantReady()) return null;

	const data = await qdrantFetch(`/collections/${encodeURIComponent(RESUME_VECTORS_COLLECTION)}/points`, {
		method: 'POST',
		body: {
			ids: [profilePointId(ownerName)],
			with_vector: true,
			with_payload: true,
		},
	});

	const point = data?.result?.[0];
	if (!point?.vector) return null;
	return { vector: point.vector, payload: point.payload || {} };
}

export async function deleteProfileVector(ownerName) {
	if (!isQdrantReady()) return false;
	try {
		await qdrantFetch(`/collections/${encodeURIComponent(RESUME_VECTORS_COLLECTION)}/points/delete?wait=true`, {
			method: 'POST',
			body: { points: [profilePointId(ownerName)] },
		});
	} catch {
		// Point may not exist
	}
	return true;
}
