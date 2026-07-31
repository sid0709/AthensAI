import { DocumentId } from '@nextoffer/shared/document-id';
import {
	backgroundTaskInputsCollection,
	backgroundTasksCollection,
	externalScrapedJobsCollection,
	jobsCollection,
} from '../../db/dataStore.js';
import { releaseSkillExtractionTaskClaims } from '../jobSkillExtraction/extractSession.js';
import { releaseTitleReviewTaskLeases } from '../jobTitleReview/titleReviewSession.js';
import { BACKGROUND_TASK_TYPES } from './taskTypes.js';
import { firestoreMutationLimiter } from './resourceLimits.js';

const RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;

export async function cleanupCancelledBackgroundTask(task) {
	if (!task?.id) return { released: 0 };
	let released = 0;
	switch (task.type) {
		case BACKGROUND_TASK_TYPES.TITLE_REVIEW:
			released = await releaseTitleReviewTaskLeases(task.id);
			break;
		case BACKGROUND_TASK_TYPES.SKILL_EXTRACTION:
			released = await releaseSkillExtractionTaskClaims(task.id);
			break;
		case BACKGROUND_TASK_TYPES.SKILL_ENRICHMENT: {
			if (!externalScrapedJobsCollection) break;
			const claimed = await externalScrapedJobsCollection.find({
				aiSkillSessionId: task.id,
				aiSkillStatus: 'extracting',
			}, { projection: { _id: 1 } }).limit(2_000).toArray();
			if (claimed.length) {
				const result = await firestoreMutationLimiter.run(() => externalScrapedJobsCollection.bulkWrite(
					claimed.map((job) => ({
						updateOne: {
							filter: { _id: job._id, aiSkillSessionId: task.id },
							update: {
								$set: { aiSkillStatus: 'pending' },
								$unset: { aiSkillClaimedAt: '', aiSkillSessionId: '' },
							},
						},
					})),
					{ ordered: false },
				));
				released = Number(result.modifiedCount || 0);
			}
			break;
		}
		case BACKGROUND_TASK_TYPES.JOB_ANALYSIS: {
			if (!jobsCollection) break;
			const ids = Array.isArray(task.payload?.recordIds) ? task.payload.recordIds : [];
			for (const id of ids) {
				if (!DocumentId.isValid(id)) continue;
				const result = await firestoreMutationLimiter.run(() => jobsCollection.updateOne(
					{ _id: new DocumentId(id), 'skillAnalysis.status': { $in: ['queued', 'analyzing'] } },
					{
						$set: { 'skillAnalysis.status': 'pending' },
						$unset: { 'skillAnalysis.queuedAt': '', 'skillAnalysis.startedAt': '' },
					},
				));
				released += Number(result.modifiedCount || 0);
			}
			break;
		}
		case BACKGROUND_TASK_TYPES.RESUME_GENERATION:
			if (backgroundTaskInputsCollection) {
				const result = await firestoreMutationLimiter.run(() => backgroundTaskInputsCollection.updateMany(
					{ workerTaskId: task.id, status: 'running' },
					{
						$set: {
							status: 'cancelled',
							finishedAt: new Date(),
							updatedAt: new Date(),
						},
					},
				));
				released = Number(result.modifiedCount || 0);
			}
			break;
		default:
			break;
	}
	return { released };
}

export async function cleanupExpiredBackgroundTaskRecords(now = new Date()) {
	const cutoff = new Date(now.getTime() - RETENTION_MS);
	const [tasks, inputs] = await Promise.all([
		backgroundTasksCollection
			? firestoreMutationLimiter.run(() => backgroundTasksCollection.deleteMany({
				finishedAt: { $lt: cutoff.toISOString() },
			}))
			: null,
		backgroundTaskInputsCollection
			? firestoreMutationLimiter.run(() => backgroundTaskInputsCollection.deleteMany({
				expiresAt: { $lt: now },
			}))
			: null,
	]);
	return {
		tasksDeleted: Number(tasks?.deletedCount || 0),
		inputsDeleted: Number(inputs?.deletedCount || 0),
	};
}
