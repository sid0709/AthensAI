import { DocumentId } from '@nextoffer/shared/document-id';
import { accountInfoCollection, jobsCollection } from '../db/dataStore.js';
import {
	mutateJobStatus,
	readCanonicalProjectedJobStatusIdsByState,
	readProjectedJobStatuses,
} from './jobStatusProjectionService.js';
import { mergeJobStatusRows, resolveJobStatusState } from '@nextoffer/shared/job-status';

function toDocumentId(value) {
	if (!value) return null;
	if (value instanceof DocumentId) return value;
	try {
		return new DocumentId(String(value));
	} catch {
		return null;
	}
}

export function normalizeApplyUrlKey(url) {
	const raw = String(url ?? '').trim();
	if (!raw) return '';
	try {
		const u = new URL(raw);
		return `${u.hostname}${u.pathname}`.replace(/\/+$/, '').toLowerCase();
	} catch {
		return raw.toLowerCase();
	}
}

export async function resolveApplierId(applierName) {
	if (!applierName || !accountInfoCollection) return null;
	const doc = await accountInfoCollection.findOne(
		{ name: String(applierName).trim() },
		{ projection: { _id: 1 } },
	);
	return doc?._id ?? null;
}

/**
 * Permanently mark a job as bid-ready / bid-completed for an applier.
 * Does not set appliedDate.
 */
export async function upsertJobBidStatus(
	applierName,
	jobId,
	{ bidReady = false, bidCompleted = false, catalog = 'market', mutationId = null } = {},
) {
	if (!jobsCollection || !applierName || !jobId || (!bidReady && !bidCompleted)) return false;
	return mutateJobStatus({
		jobId,
		applierName,
		transition: bidCompleted ? 'bid-completed' : 'bid-ready',
		catalog,
		mutationId,
	});
}

/** Original bid-ready timestamp for stable Bid Management dayKey folders. */
export async function getJobBidReadyDate(applierName, jobId) {
	if (!jobsCollection || !applierName || !jobId) return null;
	const applierId = await resolveApplierId(applierName);
	if (!toDocumentId(jobId) || !applierId) return null;
	const projected = await readProjectedJobStatuses(String(applierId), [String(jobId)]);
	const entry = mergeJobStatusRows(projected.get(String(jobId)), String(applierId));
	const raw = entry?.bidReadyDate ?? null;
	if (!raw) return null;
	if (raw instanceof Date) return raw.toISOString();
	return String(raw);
}

/**
 * Clear bid-ready / bid-completed so the job returns to New (posted) in Job Search.
 * Pulls the whole status entry when it has no applied/scheduled/declined dates.
 */
export async function clearJobBidStatus(applierName, jobId, { catalog = 'market', mutationId = null } = {}) {
	if (!jobsCollection || !applierName || !jobId) return false;
	return mutateJobStatus({ jobId, applierName, transition: 'clear-bid', catalog, mutationId });
}

/** Find a job_market doc by apply URL (exact, then soft hostname+path match). */
export async function findJobByApplyUrl(url) {
	if (!jobsCollection || !url) return null;
	const raw = String(url).trim();
	if (!raw) return null;

	const exact = await jobsCollection.findOne({
		$or: [{ applyLink: raw }, { jobLink: raw }],
	});
	if (exact) return exact;

	const key = normalizeApplyUrlKey(raw);
	if (!key) return null;

	const candidates = await jobsCollection
		.find(
			{
				$or: [
					{ applyLink: { $type: 'string', $ne: '' } },
					{ jobLink: { $type: 'string', $ne: '' } },
				],
			},
			{ projection: { applyLink: 1, jobLink: 1, title: 1, company: 1, status: 1 } },
		)
		.limit(5000)
		.toArray();

	for (const job of candidates) {
		const a = normalizeApplyUrlKey(job.applyLink);
		const b = normalizeApplyUrlKey(job.jobLink);
		if (a && (a === key || a.includes(key) || key.includes(a))) return job;
		if (b && (b === key || b.includes(key) || key.includes(b))) return job;
	}
	return null;
}

export async function markBidCompletedByUrl(applierName, url) {
	const job = await findJobByApplyUrl(url);
	if (!job?._id) return { updated: false, jobId: null };
	await upsertJobBidStatus(applierName, String(job._id), {
		bidReady: true,
		bidCompleted: true,
	});
	return { updated: true, jobId: String(job._id) };
}

export function mapBidQueueJobs(jobIds, docs, projectedStatuses, applierId, { includeCompleted = true } = {}) {
	const docsById = new Map((Array.isArray(docs) ? docs : []).map((job) => [String(job._id), job]));
	const profileId = String(applierId);
	return (Array.isArray(jobIds) ? jobIds : []).flatMap((rawJobId) => {
		const jobId = String(rawJobId);
		const job = docsById.get(jobId);
		if (!job) return [];
		const entry = mergeJobStatusRows(projectedStatuses?.get(jobId), profileId);
		const state = resolveJobStatusState(entry);
		if (state !== 'bid-ready' && !(includeCompleted && state === 'bid-completed')) return [];
		const company =
			job.company && typeof job.company === 'object'
				? String(job.company.name || '')
				: String(job.companyName || '');
		return [{
			jobId,
			title: String(job.title || 'Untitled role'),
			company,
			applyUrl: String(job.applyLink || job.jobLink || ''),
			source: String(job.source || ''),
			bidReadyDate: entry?.bidReadyDate ?? null,
			bidCompletedDate: entry?.bidCompletedDate ?? null,
			completed: state === 'bid-completed',
		}];
	});
}

/** List bid-ready (+ bid-completed, not yet applied) jobs for an applier. */
export async function listBidQueueJobs(applierName, { limit = 50, includeCompleted = true } = {}) {
	if (!jobsCollection || !applierName) return [];
	const applierId = await resolveApplierId(applierName);
	if (!applierId) return [];

	const profileId = String(applierId);
	const boundedLimit = Math.max(1, Math.min(500, Number(limit) || 50));
	const requestedStates = includeCompleted ? ['bid-ready', 'bid-completed'] : ['bid-ready'];
	const idsByState = await readCanonicalProjectedJobStatusIdsByState(profileId, requestedStates);
	const readyIds = idsByState.get('bid-ready') || [];
	const completedIds = idsByState.get('bid-completed') || [];
	// Pending work is always retained ahead of historical completed rows.
	const jobIds = [...new Set([...readyIds, ...completedIds].map(String))].slice(0, boundedLimit);
	if (!jobIds.length) return [];
	const documentIds = jobIds.map(toDocumentId).filter(Boolean);
	const [docs, projectedStatuses] = await Promise.all([
		jobsCollection.find(
			{ _id: { $in: documentIds } },
			{ projection: { title: 1, company: 1, companyName: 1, applyLink: 1, jobLink: 1, source: 1 } },
		).toArray(),
		readProjectedJobStatuses(profileId, jobIds),
	]);

	return mapBidQueueJobs(jobIds, docs, projectedStatuses, profileId, { includeCompleted });
}
