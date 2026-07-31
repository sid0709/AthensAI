import { getBackgroundQueue, getBackgroundQueueEvents } from './bullConnection.js';
import { getRedis } from '../../db/redis.js';
import { backgroundTaskKeys } from './redisKeys.js';
import { requireBackgroundWorker } from './taskStore.js';
import { assertBackgroundTaskActive } from './taskContext.js';
import { TASK_LANES } from './taskTypes.js';

const PDF_JOB_TIMEOUT_MS = Math.max(
	30_000,
	Number.parseInt(String(process.env.BACKGROUND_PDF_JOB_TIMEOUT_MS || ''), 10) || 10 * 60 * 1_000,
);
const PDF_QUEUE_READY_TIMEOUT_MS = Math.max(
	250,
	Number.parseInt(String(process.env.BACKGROUND_QUEUE_READY_TIMEOUT_MS || ''), 10) || 2_000,
);
const INTERACTIVE_PDF_CONTROL_TTL_SECONDS = 10 * 60;

function abortError(signal) {
	return signal?.reason instanceof Error
		? signal.reason
		: Object.assign(new Error('PDF rendering cancelled'), { name: 'AbortError' });
}

async function enqueuePdfLaneJob({ name, data, jobId, signal }) {
	if (signal?.aborted) throw abortError(signal);
	await assertBackgroundTaskActive(signal);
	await requireBackgroundWorker();
	const queue = getBackgroundQueue(TASK_LANES.PDF);
	const events = getBackgroundQueueEvents(TASK_LANES.PDF);
	let readyTimer;
	try {
		await Promise.race([
			events.waitUntilReady(),
			new Promise((_, reject) => {
				readyTimer = setTimeout(() => {
					const error = new Error('Background PDF queue is unavailable');
					error.status = 503;
					reject(error);
				}, PDF_QUEUE_READY_TIMEOUT_MS);
				readyTimer.unref?.();
			}),
		]);
	} finally {
		if (readyTimer) clearTimeout(readyTimer);
	}
	const job = await queue.add(
		name,
		data,
		{
			jobId,
			removeOnComplete: { age: 24 * 60 * 60, count: 5_000 },
			removeOnFail: { age: 7 * 24 * 60 * 60, count: 5_000 },
		},
	);
	const finished = job.waitUntilFinished(events, PDF_JOB_TIMEOUT_MS);
	if (!signal) return finished;
	return new Promise((resolve, reject) => {
		const aborted = () => {
			const taskId = String(data?.taskId || '');
			if (taskId.startsWith('interactive-')) {
				const at = new Date().toISOString();
				const message = JSON.stringify({ taskId, at });
				void getRedis().set(backgroundTaskKeys.cancel(taskId), at, {
					EX: INTERACTIVE_PDF_CONTROL_TTL_SECONDS,
				}).then(() => getRedis().publish(backgroundTaskKeys.controlChannel, message)).catch(() => undefined);
			}
			void job.remove().catch(() => undefined);
			reject(abortError(signal));
		};
		signal.addEventListener('abort', aborted, { once: true });
		finished.then(
			(value) => {
				signal.removeEventListener('abort', aborted);
				resolve(value);
			},
			(error) => {
				signal.removeEventListener('abort', aborted);
				reject(error);
			},
		);
	});
}

export function renderResumePdfInBackgroundLane({ taskId, profileId, jobId, signal }) {
	return enqueuePdfLaneJob({
		name: 'render-resume-pdf',
		data: {
			maintenance: 'render-resume-pdf',
			taskId: String(taskId),
			...(profileId ? { profileId: String(profileId) } : {}),
			jobId: String(jobId),
		},
		jobId: `resume-pdf-${taskId}-${jobId}`,
		signal,
	});
}

export function renderResumeIdentityPdfInBackgroundLane({
	taskId,
	profileId,
	jobId,
	generationId,
	signal,
}) {
	return enqueuePdfLaneJob({
		name: 'render-resume-identity-pdf',
		data: {
			maintenance: 'render-resume-identity-pdf',
			taskId: String(taskId),
			...(profileId ? { profileId: String(profileId) } : {}),
			jobId: String(jobId),
			generationId: String(generationId),
		},
		jobId: `resume-identity-pdf-${taskId}-${generationId}`,
		signal,
	});
}
