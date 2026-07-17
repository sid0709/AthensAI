import { ObjectId } from 'mongodb';
import { accountInfoCollection, jobsCollection } from '../db/mongo.js';

function toObjectId(value) {
	if (!value) return null;
	if (value instanceof ObjectId) return value;
	try {
		return new ObjectId(String(value));
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

function findStatusEntry(job, applierId) {
	if (!job || !Array.isArray(job.status)) return null;
	return (
		job.status.find((s) => s && String(s.applier) === String(applierId)) ?? null
	);
}

/**
 * Permanently mark a job as bid-ready / bid-completed for an applier.
 * Does not set appliedDate.
 */
export async function upsertJobBidStatus(
	applierName,
	jobId,
	{ bidReady = false, bidCompleted = false } = {},
) {
	if (!jobsCollection || !applierName || !jobId) return false;
	const objectId = toObjectId(jobId);
	const applierId = await resolveApplierId(applierName);
	if (!objectId || !applierId) return false;

	const now = new Date().toISOString();
	const existing = await jobsCollection.findOne(
		{ _id: objectId, 'status.applier': applierId },
		{ projection: { status: 1 } },
	);

	if (!existing) {
		const entry = { applier: applierId };
		if (bidReady) entry.bidReadyDate = now;
		if (bidCompleted) entry.bidCompletedDate = now;
		await jobsCollection.updateOne({ _id: objectId }, { $push: { status: entry } });
		return true;
	}

	const entry = findStatusEntry(existing, applierId);
	const $set = {};
	// Preserve the original bid-ready day so Bid Management folders stay stable
	// across Apply / submit / reject. Only stamp when missing.
	if (bidReady && !entry?.bidReadyDate) {
		$set['status.$[elem].bidReadyDate'] = now;
	}
	if (bidCompleted && !entry?.bidCompletedDate) {
		$set['status.$[elem].bidCompletedDate'] = now;
	}
	if (!Object.keys($set).length) return true;

	await jobsCollection.updateOne(
		{ _id: objectId },
		{ $set },
		{ arrayFilters: [{ 'elem.applier': applierId }] },
	);
	return true;
}

/** Original bid-ready timestamp for stable Bid Management dayKey folders. */
export async function getJobBidReadyDate(applierName, jobId) {
	if (!jobsCollection || !applierName || !jobId) return null;
	const objectId = toObjectId(jobId);
	const applierId = await resolveApplierId(applierName);
	if (!objectId || !applierId) return null;
	const job = await jobsCollection.findOne(
		{ _id: objectId, 'status.applier': applierId },
		{ projection: { status: 1 } },
	);
	const entry = findStatusEntry(job, applierId);
	const raw = entry?.bidReadyDate ?? null;
	if (!raw) return null;
	if (raw instanceof Date) return raw.toISOString();
	return String(raw);
}

/**
 * Clear bid-ready / bid-completed so the job returns to New (posted) in Job Search.
 * Pulls the whole status entry when it has no applied/scheduled/declined dates.
 */
export async function clearJobBidStatus(applierName, jobId) {
	if (!jobsCollection || !applierName || !jobId) return false;
	const objectId = toObjectId(jobId);
	const applierId = await resolveApplierId(applierName);
	if (!objectId || !applierId) return false;

	const job = await jobsCollection.findOne(
		{ _id: objectId, 'status.applier': applierId },
		{ projection: { status: 1 } },
	);
	if (!job) return false;

	const entry = findStatusEntry(job, applierId);
	if (!entry) return false;

	const hasPipeline =
		Boolean(entry.appliedDate) || Boolean(entry.scheduledDate) || Boolean(entry.declinedDate);

	if (!hasPipeline) {
		await jobsCollection.updateOne(
			{ _id: objectId },
			{ $pull: { status: { applier: applierId } } },
		);
		return true;
	}

	await jobsCollection.updateOne(
		{ _id: objectId },
		{
			$unset: {
				'status.$[elem].bidReadyDate': '',
				'status.$[elem].bidCompletedDate': '',
			},
		},
		{ arrayFilters: [{ 'elem.applier': applierId }] },
	);
	return true;
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

/** List bid-ready (+ bid-completed, not yet applied) jobs for an applier. */
export async function listBidQueueJobs(applierName, { limit = 50, includeCompleted = true } = {}) {
	if (!jobsCollection || !applierName) return [];
	const applierId = await resolveApplierId(applierName);
	if (!applierId) return [];

	const elem = {
		applier: applierId,
		bidReadyDate: { $exists: true },
		appliedDate: { $exists: false },
		scheduledDate: { $exists: false },
		declinedDate: { $exists: false },
	};
	if (!includeCompleted) {
		elem.bidCompletedDate = { $exists: false };
	}

	const docs = await jobsCollection
		.find({ status: { $elemMatch: elem } })
		.sort({ _id: -1 })
		.limit(Math.max(1, Math.min(500, Number(limit) || 50)))
		.toArray();

	return docs.map((job) => {
		const entry = findStatusEntry(job, applierId);
		const company =
			job.company && typeof job.company === 'object'
				? String(job.company.name || '')
				: String(job.companyName || '');
		return {
			jobId: String(job._id),
			title: String(job.title || 'Untitled role'),
			company,
			applyUrl: String(job.applyLink || job.jobLink || ''),
			source: String(job.source || ''),
			bidReadyDate: entry?.bidReadyDate ?? null,
			bidCompletedDate: entry?.bidCompletedDate ?? null,
			completed: Boolean(entry?.bidCompletedDate),
		};
	});
}
