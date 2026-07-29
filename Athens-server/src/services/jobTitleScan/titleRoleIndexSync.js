import {
	TITLE_SCAN_ROLES,
	TITLE_SCAN_ROLE_SET,
	inferTitleScanRole,
} from '../../config/jobTitleScanRoles.js';
import { jobsCollection } from '../../db/dataStore.js';
import { bumpCatalogRevision } from '../matching/jobRankingIndex.js';
import {
	countJobRankingPoints,
	updateJobRankingTitleRoles,
} from '../vectorStore/qdrantClient.js';

const configuredBatchSize = Number(process.env.JOB_TITLE_ROLE_INDEX_BATCH_SIZE || 1_000);
const SYNC_BATCH_SIZE = Number.isFinite(configuredBatchSize)
	? Math.max(100, configuredBatchSize)
	: 1_000;

function validUpdates(rolesByJobId) {
	return Object.entries(rolesByJobId || {}).flatMap(([jobId, role]) => {
		const normalizedJobId = String(jobId || '').trim();
		const normalizedRole = String(role || '').trim();
		return normalizedJobId && TITLE_SCAN_ROLE_SET.has(normalizedRole)
			? [{ jobId: normalizedJobId, role: normalizedRole }]
			: [];
	});
}

/** Keep newly classified title roles in the read model used by Job Search v2. */
export async function syncJobTitleRoleUpdates(
	rolesByJobId,
	{
		updateIndexed = updateJobRankingTitleRoles,
		bumpRevision = bumpCatalogRevision,
	} = {},
) {
	const updates = validUpdates(rolesByJobId);
	if (!updates.length) return { updated: 0, revision: null };
	const updated = await updateIndexed(updates);
	const revision = updated > 0 ? await bumpRevision() : null;
	return { updated, revision };
}

/**
 * Repair deployments whose ranking points have no role facet. Scanned roles
 * win; otherwise the same deterministic title fallback used by the read model
 * is indexed. Once counts agree, startup skips the database scan.
 */
export async function reconcileJobTitleRoleIndex({
	force = false,
	collection = jobsCollection,
	countIndexed = countJobRankingPoints,
	updateIndexed = updateJobRankingTitleRoles,
	bumpRevision = bumpCatalogRevision,
} = {}) {
	if (!collection) return { processed: 0, indexed: 0, updated: 0, skipped: true };
	const processedFilter = {};
	const marketFilter = {
		must: [{ key: 'catalog', match: { value: 'market' } }],
	};
	const roleFilter = {
		must: [
			...marketFilter.must,
			{ key: 'titleRoles', match: { any: TITLE_SCAN_ROLES } },
		],
	};
	const [processed, indexed, totalIndexed] = await Promise.all([
		collection.countDocuments(processedFilter),
		countIndexed(roleFilter),
		countIndexed(marketFilter),
	]);
	if (!force && indexed >= totalIndexed) {
		return { processed, indexed, totalIndexed, updated: 0, skipped: true };
	}

	const options = {
		projection: { _id: 1, title: 1, titleScanned: 1 },
		pageSize: SYNC_BATCH_SIZE,
	};
	const cursor = typeof collection.findPaged === 'function'
		? collection.findPaged(processedFilter, options)
		: collection.find(processedFilter, { projection: options.projection });
	let batch = [];
	let updated = 0;
	for await (const job of cursor) {
		const scannedRole = String(job.titleScanned || '').trim();
		batch.push({
			jobId: String(job._id),
			role: TITLE_SCAN_ROLE_SET.has(scannedRole)
				? scannedRole
				: inferTitleScanRole(job.title),
		});
		if (batch.length >= SYNC_BATCH_SIZE) {
			updated += await updateIndexed(batch);
			batch = [];
		}
	}
	if (batch.length) updated += await updateIndexed(batch);
	if (updated > 0) await bumpRevision();
	return { processed, indexed, totalIndexed, updated, skipped: false };
}

export const titleRoleIndexSyncTest = { validUpdates };
