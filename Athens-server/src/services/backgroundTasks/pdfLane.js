import { randomUUID } from 'node:crypto';
import {
	createBackgroundTask,
	getBackgroundTask,
	waitForBackgroundTask,
} from './taskStore.js';
import { assertBackgroundTaskActive } from './taskContext.js';
import { BACKGROUND_TASK_TYPES } from './taskTypes.js';

const PDF_JOB_TIMEOUT_MS = Math.max(
	30_000,
	Number.parseInt(String(process.env.BACKGROUND_PDF_JOB_TIMEOUT_MS || ''), 10) || 10 * 60 * 1_000,
);

function abortError(signal) {
	return signal?.reason instanceof Error
		? signal.reason
		: Object.assign(new Error('PDF rendering cancelled'), { name: 'AbortError' });
}

async function enqueuePdfLaneTask({ type, taskId, profileId, applierName, payload, signal }) {
	if (signal?.aborted) throw abortError(signal);
	await assertBackgroundTaskActive(signal);
	const parent = taskId && !String(taskId).startsWith('interactive-')
		? await getBackgroundTask(taskId)
		: null;
	const identity = String(profileId || parent?.profileId || applierName || '').trim();
	const name = String(applierName || parent?.applierName || '').trim();
	if (!identity) throw new Error('PDF task profile was not found');
	const queued = await createBackgroundTask({
		requestId: `pdf:${type}:${taskId || 'interactive'}:${randomUUID()}`,
		type,
		profileId: identity,
		applierName: name,
		ownerUid: parent?.ownerUid || null,
		parentTaskId: parent?.id || null,
		payload,
		progress: { total: 1, phase: 'queued' },
		maxAttempts: 3,
	});
	return waitForBackgroundTask(queued.task.id, { signal, timeoutMs: PDF_JOB_TIMEOUT_MS });
}

export function renderResumePdfInBackgroundLane({ taskId, profileId, applierName, jobId, signal }) {
	return enqueuePdfLaneTask({
		type: BACKGROUND_TASK_TYPES.RENDER_RESUME_PDF,
		taskId: String(taskId || ''),
		profileId,
		applierName,
		payload: { jobId: String(jobId) },
		signal,
	});
}

export function renderResumeIdentityPdfInBackgroundLane({
	taskId,
	profileId,
	applierName,
	jobId,
	generationId,
	signal,
}) {
	return enqueuePdfLaneTask({
		type: BACKGROUND_TASK_TYPES.RENDER_RESUME_IDENTITY_PDF,
		taskId: String(taskId || ''),
		profileId,
		applierName,
		payload: { jobId: String(jobId), generationId: String(generationId) },
		signal,
	});
}
