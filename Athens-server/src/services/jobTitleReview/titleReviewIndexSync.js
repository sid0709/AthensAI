import { createHash, randomUUID } from 'node:crypto';
import { getFirestoreDb } from '../firebase/firebaseAdmin.js';
import { createBackgroundTask } from '../backgroundTasks/taskStore.js';
import { BACKGROUND_TASK_TYPES } from '../backgroundTasks/taskTypes.js';
import { syncApprovedCatalogMembership } from '../jobCatalogCountService.js';
import { invalidateJobListV3Counts } from '../jobListV3Service.js';

function outboxId(jobId, label) {
	return createHash('sha256').update(`${jobId}\0${label}\0${Date.now()}\0${randomUUID()}`).digest('hex');
}

/** Publish Title Review changes to Algolia and reconcile per-profile visibility. */
export async function syncJobTitleReviewUpdates(labelsByJobId) {
	const updates = Object.entries(labelsByJobId || {}).flatMap(([jobId, label]) =>
		jobId && (label === 'APPROVED' || label === 'REVIEW_REQUIRED')
			? [{ jobId: String(jobId), label }]
			: [],
	);
	if (!updates.length) return { updated: 0, taskId: null };
	const db = getFirestoreDb();
	const now = new Date();
	const batch = db.batch();
	for (const update of updates) {
		batch.create(db.collection('search_outbox').doc(outboxId(update.jobId, update.label)), {
			jobId: update.jobId,
			operation: 'upsert',
			status: 'pending',
			attempts: 0,
			createdAt: now,
			updatedAt: now,
		});
	}
	await batch.commit();
	await syncApprovedCatalogMembership(updates.map((update) => update.jobId));
	invalidateJobListV3Counts();
	const queued = await createBackgroundTask({
		requestId: `title-visibility:${randomUUID()}`,
		type: BACKGROUND_TASK_TYPES.JOB_STATUS_VISIBILITY,
		profileId: 'system',
		applierName: 'system',
		payload: { recordIds: updates.map((update) => update.jobId) },
		progress: { total: updates.length, phase: 'queued' },
		skipWorkerCheck: true,
	});
	return { updated: updates.length, taskId: queued.task.id };
}
