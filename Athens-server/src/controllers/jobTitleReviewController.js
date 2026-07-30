import { jobsCollection } from '../db/dataStore.js';
import { findAccountByApplierName } from '../services/mail/credentials.js';
import { isBetaTier } from '../lib/betaTier.js';
import { buildCaseInsensitiveRegexFilter } from '../utils/safeRegex.js';
import {
	getTitleReviewSessionStatus,
	invalidateTitleReviewCounts,
	startTitleReviewSession,
	stopTitleReviewSession,
} from '../services/jobTitleReview/titleReviewSession.js';
import { syncJobTitleReviewUpdates } from '../services/jobTitleReview/titleReviewIndexSync.js';
import { normalizeJobRemovalIds, deleteJobDocuments } from '../services/jobRemovalService.js';
import { deleteScoresForJobs } from '../services/matching/matchScoreStore.js';
import { removeJobsFromRanking } from '../services/matching/jobRankingIndex.js';
import { evictJobsFromJobListReadModel } from '../services/jobListReadModelService.js';
import { invalidateLiveProjectedStatusCount } from '../services/jobStatusProjectionService.js';
import { invalidateJobListCountCache } from './jobController.js';

async function requireBetaApplierName(applierNameRaw, res) {
	const applierName = String(applierNameRaw || '').trim();
	if (!applierName) {
		res.status(400).json({ success: false, error: 'applierName is required.' });
		return null;
	}
	const account = await findAccountByApplierName(applierName);
	if (!account) {
		res.status(404).json({ success: false, error: `No account named "${applierName}".` });
		return null;
	}
	if (!isBetaTier(account.tier)) {
		res.status(403).json({ success: false, error: 'Beta workspace required.', betaRequired: true });
		return null;
	}
	return applierName;
}

function reviewCompany(job) {
	if (typeof job?.company === 'string') return job.company;
	return String(job?.company?.name || job?.companyName || 'Unknown');
}

export async function getTitleReviewStatus(req, res) {
	try {
		const applierName = await requireBetaApplierName(req.query?.applierName, res);
		if (!applierName) return;
		return res.json({ success: true, ...(await getTitleReviewSessionStatus()) });
	} catch (error) {
		console.error('GET /api/jobs/title-review/status error', error);
		return res.status(500).json({ success: false, error: error.message });
	}
}

export async function startTitleReview(req, res) {
	try {
		const applierName = await requireBetaApplierName(req.body?.applierName, res);
		if (!applierName) return;
		const result = await startTitleReviewSession({ applierName });
		return res.status(result.started ? 202 : 200).json({ success: true, ...result });
	} catch (error) {
		const status = error.message.includes('already running') ? 409 : 400;
		console.error('POST /api/jobs/title-review/start error', error);
		return res.status(status).json({ success: false, error: error.message });
	}
}

export async function stopTitleReview(req, res) {
	try {
		const applierName = await requireBetaApplierName(req.body?.applierName, res);
		if (!applierName) return;
		return res.json({ success: true, ...stopTitleReviewSession() });
	} catch (error) {
		console.error('POST /api/jobs/title-review/stop error', error);
		return res.status(500).json({ success: false, error: error.message });
	}
}

export async function listTitleReviewJobs(req, res) {
	try {
		const applierName = await requireBetaApplierName(req.query?.applierName, res);
		if (!applierName) return;
		if (!jobsCollection) return res.status(503).json({ success: false, error: 'Database not ready' });

		const tab = req.query?.tab === 'failed' ? 'failed' : 'review_required';
		const page = Math.max(1, Number(req.query?.page) || 1);
		const limit = Math.max(10, Math.min(100, Number(req.query?.limit) || 25));
		const sort = req.query?.sort === 'oldest' ? 1 : -1;
		const query = {
			$and: [
				tab === 'failed'
					? { 'titleReview.processingState': 'failed' }
					: { 'titleReview.label': 'REVIEW_REQUIRED' },
			],
		};
		const titleFilter = buildCaseInsensitiveRegexFilter(req.query?.q);
		if (titleFilter) query.$and.push({ title: titleFilter });
		const effectiveQuery = query.$and.length === 1 ? query.$and[0] : query;
		const [documents, total] = await Promise.all([
			jobsCollection.find(effectiveQuery, { projection: { description: 0, jobDescription: 0 } })
				.sort({ postedAt: sort, _id: sort })
				.skip((page - 1) * limit)
				.limit(limit)
				.toArray(),
			jobsCollection.countDocuments(effectiveQuery),
		]);
		return res.json({
			success: true,
			data: documents.map((job) => ({
				id: String(job._id),
				title: String(job.title || 'Untitled role'),
				company: reviewCompany(job),
				source: String(job.source || 'Other'),
				postedAt: job.postedAt || job._createdAt || null,
				applyUrl: String(job.applyLink || job.jobLink || ''),
				titleReview: job.titleReview || null,
			})),
			pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
		});
	} catch (error) {
		console.error('GET /api/jobs/title-review error', error);
		return res.status(500).json({ success: false, error: error.message });
	}
}

export async function approveTitleReviewJobs(req, res) {
	try {
		const applierName = await requireBetaApplierName(req.body?.applierName, res);
		if (!applierName) return;
		if (!jobsCollection) return res.status(503).json({ success: false, error: 'Database not ready' });
		const ids = normalizeJobRemovalIds(req.body);
		if (!ids.length) return res.status(400).json({ success: false, error: 'Missing ids array' });
		const eligible = await jobsCollection.find({
			_id: { $in: ids },
			'titleReview.label': 'REVIEW_REQUIRED',
		}, { projection: { _id: 1 } }).toArray();
		const now = new Date().toISOString();
		const writes = await Promise.all(eligible.map(async (job) => ({
			id: String(job._id),
			result: await jobsCollection.updateOne(
				{ _id: job._id, 'titleReview.label': 'REVIEW_REQUIRED' },
				{
					$set: {
						'titleReview.processingState': 'completed',
						'titleReview.label': 'APPROVED',
						'titleReview.decisionSource': 'manual',
						'titleReview.approvedAt': now,
						'titleReview.approvedBy': applierName,
					},
					$unset: { 'titleReview.error': '', 'titleReview.lease': '' },
				},
			),
		})));
		const approvedIds = writes.filter(({ result }) => result.modifiedCount).map(({ id }) => id);
		if (approvedIds.length) {
			try {
				await syncJobTitleReviewUpdates(Object.fromEntries(approvedIds.map((id) => [id, 'APPROVED'])));
			} catch (error) {
				console.warn('[title-review] approval read-model sync failed', error?.message || error);
			}
			invalidateJobListCountCache();
			invalidateTitleReviewCounts();
		}
		return res.json({ success: true, approvedCount: approvedIds.length, approvedIds });
	} catch (error) {
		console.error('POST /api/jobs/title-review/approve error', error);
		return res.status(500).json({ success: false, error: error.message });
	}
}

export async function removeTitleReviewJobs(req, res) {
	try {
		const applierName = await requireBetaApplierName(req.body?.applierName, res);
		if (!applierName) return;
		if (!jobsCollection) return res.status(503).json({ success: false, error: 'Database not ready' });
		const requestedIds = normalizeJobRemovalIds(req.body);
		if (!requestedIds.length) return res.status(400).json({ success: false, error: 'Missing ids array' });
		const eligible = await jobsCollection.find({
			_id: { $in: requestedIds },
			$or: [
				{ 'titleReview.label': 'REVIEW_REQUIRED' },
				{ 'titleReview.processingState': 'failed' },
			],
		}, { projection: { _id: 1 } }).toArray();
		const ids = eligible.map((job) => String(job._id));
		if (!ids.length) return res.json({ success: true, deletedCount: 0, deletedIds: [] });
		const { deletedCount } = await deleteJobDocuments({ ids, jobsCollection });
		evictJobsFromJobListReadModel(ids);
		invalidateLiveProjectedStatusCount();
		invalidateJobListCountCache();
		invalidateTitleReviewCounts();
		await Promise.allSettled([deleteScoresForJobs(ids), removeJobsFromRanking(ids)]);
		return res.json({ success: true, deletedCount, deletedIds: ids });
	} catch (error) {
		console.error('POST /api/jobs/title-review/remove error', error);
		return res.status(500).json({ success: false, error: error.message });
	}
}
