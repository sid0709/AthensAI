import 'dotenv/config';

import { DocumentId } from '@nextoffer/shared/document-id';
import { Worker } from 'bullmq';
import { installTerminalLogger } from '@nextoffer/shared/terminal-log';
import { accountInfoCollection, initDataStore, closeDataStore } from '../db/dataStore.js';
import { initRedis, closeRedis, getRedis } from '../db/redis.js';
import {
	initJobRankingCollection,
	initQdrantCollections,
} from '../services/vectorStore/qdrantClient.js';
import { loadCanonicalSkillDictionary } from '../services/matching/canonicalSkillDictionary.js';
import { resolveAgentJobDraftPdf } from '../services/agentResumeGenService.js';
import { renderIdentityRefreshedGenerationPdf } from '../services/refreshGeneratedResumesIdentity.js';
import { bullConnectionOptions, closeBackgroundQueues, getBackgroundQueue } from '../services/backgroundTasks/bullConnection.js';
import { backgroundTaskKeys } from '../services/backgroundTasks/redisKeys.js';
import { processBackgroundTask } from '../services/backgroundTasks/taskProcessors.js';
import { runWithBackgroundTaskContext } from '../services/backgroundTasks/taskContext.js';
import {
	cleanupCancelledBackgroundTask,
	cleanupExpiredBackgroundTaskRecords,
} from '../services/backgroundTasks/maintenance.js';
import {
	acknowledgeBackgroundTaskCancellation,
	completeBackgroundTask,
	failBackgroundTask,
	getBackgroundTask,
	isBackgroundTaskCancellationRequested,
	markBackgroundTaskRunning,
	writeBackgroundWorkerHeartbeat,
} from '../services/backgroundTasks/taskStore.js';
import {
	TASK_LANES,
	TERMINAL_TASK_STATUSES,
} from '../services/backgroundTasks/taskTypes.js';
import {
	incrementCounter,
	observeHistogram,
	setGauge,
	startAggregateMetricsServer,
	startEventLoopDelayMetrics,
	stopAggregateMetricsServer,
} from '../services/monitoring/metrics.js';

installTerminalLogger('background-worker');
process.env.BACKGROUND_TASK_WORKER = 'true';

/** A parent task and one or more PDF children can be active at the same time. */
const activeControllers = new Map();
const workers = [];
let subscriber = null;
let heartbeatTimer = null;
let stopEventLoopMetrics = null;
let shuttingDown = false;

function workerConcurrency(name, fallback) {
	const value = Number.parseInt(String(process.env[name] || ''), 10);
	return Math.max(1, Number.isFinite(value) ? value : fallback);
}

function isAbortError(error, signal) {
	return signal?.aborted || error?.name === 'AbortError';
}

function cancellationError(message = 'Background task cancelled') {
	return Object.assign(new Error(message), { name: 'AbortError' });
}

function registerController(taskId, controller) {
	const controllers = activeControllers.get(taskId) || new Set();
	controllers.add(controller);
	activeControllers.set(taskId, controllers);
}

function unregisterController(taskId, controller) {
	const controllers = activeControllers.get(taskId);
	if (!controllers) return;
	controllers.delete(controller);
	if (!controllers.size) activeControllers.delete(taskId);
}

function abortControllers(taskId) {
	for (const controller of activeControllers.get(taskId) || []) {
		if (!controller.signal.aborted) controller.abort(cancellationError());
	}
}

function watchDurableCancellation(taskId, controller) {
	let busy = false;
	const timer = setInterval(() => {
		if (busy || controller.signal.aborted) return;
		busy = true;
	void getRedis().exists(backgroundTaskKeys.cancel(taskId))
			.then(async (requested) => {
				if (!requested) return;
				if (!controller.signal.aborted) controller.abort(cancellationError());
				// Pub/Sub is an acceleration path, not the source of truth. If a
				// broadcast was missed, the durable-key watchdog still acknowledges
				// Stop without waiting for the provider stack to unwind.
				const cancelled = await acknowledgeBackgroundTaskCancellation(taskId);
				if (cancelled) await enqueueTaskCleanup(cancelled);
			})
			.catch(() => undefined)
			.finally(() => { busy = false; });
	}, 250);
	timer.unref?.();
	return () => clearInterval(timer);
}

async function runCancellableChild(taskId, operation) {
	if (!taskId || await isBackgroundTaskCancellationRequested(taskId)) throw cancellationError();
	const controller = new AbortController();
	registerController(taskId, controller);
	const stopWatching = watchDurableCancellation(taskId, controller);
	try {
		return await runWithBackgroundTaskContext(taskId, () => operation(controller.signal));
	} finally {
		stopWatching();
		unregisterController(taskId, controller);
	}
}

async function enqueueTaskCleanup(task) {
	if (!task?.id) return;
	await getBackgroundQueue(TASK_LANES.CLEANUP).add(
		'task-cleanup',
		{ maintenance: 'task-cleanup', taskId: task.id },
		{
			jobId: `task-cleanup-${task.id}`,
			attempts: 3,
			backoff: { type: 'exponential', delay: 1_000 },
		},
	).catch((error) => {
		console.warn('[background-task] cleanup enqueue failed:', error?.message || error);
	});
}

async function processMaintenanceJob(job) {
	if (job.data?.maintenance === 'retention-cleanup') {
		return cleanupExpiredBackgroundTaskRecords();
	}
	if (job.data?.maintenance === 'task-cleanup') {
		const task = await getBackgroundTask(String(job.data?.taskId || ''));
		return task ? cleanupCancelledBackgroundTask(task) : { skipped: true };
	}
	if (job.data?.maintenance === 'render-resume-pdf') {
		const taskId = String(job.data?.taskId || '');
		const parentTask = await getBackgroundTask(taskId);
		let applierName = parentTask?.applierName || '';
		const profileId = String(job.data?.profileId || '');
		if (!applierName && profileId && DocumentId.isValid(profileId)) {
			const account = await accountInfoCollection?.findOne(
				{ _id: new DocumentId(profileId) },
				{ projection: { name: 1 } },
			);
			applierName = String(account?.name || '');
		}
		if (!applierName) throw new Error('Résumé PDF profile was not found');
		const rendered = await runCancellableChild(taskId, (signal) => resolveAgentJobDraftPdf({
			applierName,
			jobId: String(job.data?.jobId || ''),
			signal,
		}));
		if (!rendered?.buffer?.length || !rendered?.draftPath) {
			throw new Error('Saved résumé could not be rendered as PDF');
		}
		return { draftPath: rendered.draftPath, byteLength: rendered.buffer.length };
	}
	if (job.data?.maintenance === 'render-resume-identity-pdf') {
		const taskId = String(job.data?.taskId || '');
		const parentTask = await getBackgroundTask(taskId);
		if (!parentTask?.applierName) throw new Error('Parent résumé task was not found');
		const rendered = await runCancellableChild(taskId, (signal) => renderIdentityRefreshedGenerationPdf({
			applierName: parentTask.applierName,
			generationId: String(job.data?.generationId || ''),
			jobId: String(job.data?.jobId || ''),
			signal,
		}));
		if (!rendered?.buffer?.length || !rendered?.draftPath) {
			throw new Error('Identity-refreshed résumé could not be rendered as PDF');
		}
		return { draftPath: rendered.draftPath, byteLength: rendered.buffer.length };
	}
	return null;
}

async function processJob(job) {
	if (job.data?.maintenance) return processMaintenanceJob(job);
	const taskId = String(job.data?.taskId || '');
	if (!taskId) throw new Error('Background queue job is missing taskId');
	let task = await getBackgroundTask(taskId);
	if (!task || TERMINAL_TASK_STATUSES.has(task.status)) return { skipped: true };
	const taskStartedAt = Date.now();
	const metricLabels = { type: task.type, lane: task.lane };
	const queuedAt = Date.parse(task.createdAt || '');
	if (Number.isFinite(queuedAt)) {
		observeHistogram('athens_background_task_queue_age_seconds', metricLabels, Math.max(0, taskStartedAt - queuedAt) / 1_000);
	}
	incrementCounter('athens_background_tasks_started_total', metricLabels);
	if (await isBackgroundTaskCancellationRequested(taskId)) {
		const cancelled = await acknowledgeBackgroundTaskCancellation(taskId);
		await enqueueTaskCleanup(cancelled);
		return { cancelled: true };
	}

	const controller = new AbortController();
	registerController(taskId, controller);
	const stopWatching = watchDurableCancellation(taskId, controller);
	try {
		task = await markBackgroundTaskRunning(taskId);
		if (!task) return { skipped: true };
		if (TERMINAL_TASK_STATUSES.has(task.status)) {
			return { skipped: true, status: task.status };
		}
		if (controller.signal.aborted || await isBackgroundTaskCancellationRequested(taskId)) {
			const cancelled = await acknowledgeBackgroundTaskCancellation(taskId);
			await enqueueTaskCleanup(cancelled);
			return { cancelled: true };
		}
		const output = await runWithBackgroundTaskContext(
			taskId,
			() => processBackgroundTask(task, controller.signal),
		);
		if (controller.signal.aborted || await isBackgroundTaskCancellationRequested(taskId)) {
			const cancelled = await acknowledgeBackgroundTaskCancellation(taskId, { progress: output?.progress });
			await enqueueTaskCleanup(cancelled);
			return { cancelled: true };
		}
		await completeBackgroundTask(taskId, output || {});
		incrementCounter('athens_background_tasks_completed_total', metricLabels);
		observeHistogram('athens_background_task_duration_seconds', metricLabels, (Date.now() - taskStartedAt) / 1_000);
		return output?.result || { completed: true };
	} catch (error) {
		if (isAbortError(error, controller.signal) || await isBackgroundTaskCancellationRequested(taskId)) {
			const cancelled = await acknowledgeBackgroundTaskCancellation(taskId);
			await enqueueTaskCleanup(cancelled);
			return { cancelled: true };
		}
		await failBackgroundTask(taskId, error);
		incrementCounter('athens_background_tasks_failed_total', metricLabels);
		console.error(`[background-task] ${taskId} failed:`, error?.stack || error);
		return { failed: true, error: error?.message || String(error) };
	} finally {
		stopWatching();
		unregisterController(taskId, controller);
	}
}

async function updateQueueMetrics() {
	for (const lane of Object.values(TASK_LANES)) {
		const counts = await getBackgroundQueue(lane).getJobCounts('waiting', 'active', 'delayed', 'failed');
		for (const [state, count] of Object.entries(counts)) {
			setGauge('athens_background_queue_jobs', { lane, state }, Number(count || 0));
		}
	}
}

function createLaneWorker(lane, concurrency) {
	const worker = new Worker(backgroundTaskKeys.queue(lane), processJob, {
		connection: bullConnectionOptions({ worker: true }),
		concurrency,
		lockDuration: 120_000,
		stalledInterval: 30_000,
		maxStalledCount: 2,
	});
	worker.on('error', (error) => {
		console.error(`[background-task] ${lane} worker error:`, error?.message || error);
	});
	worker.on('failed', (job, error) => {
		console.error(`[background-task] ${lane} queue job ${job?.id || '(unknown)'} failed:`, error?.message || error);
		const taskId = String(job?.data?.taskId || '');
		if (!taskId || job?.data?.maintenance) return;
		void failBackgroundTask(taskId, error).catch((reconcileError) => {
			console.warn(
				`[background-task] failed queue job ${taskId} could not reconcile task state:`,
				reconcileError?.message || reconcileError,
			);
		});
	});
	workers.push(worker);
	return worker;
}

async function startControlSubscriber() {
	subscriber = getRedis().duplicate();
	await subscriber.connect();
	await subscriber.subscribe(backgroundTaskKeys.controlChannel, (raw) => {
		void (async () => {
			let message;
			try {
				message = JSON.parse(raw);
			} catch {
				return;
			}
			const taskId = String(message?.taskId || '');
			if (!taskId) return;
			abortControllers(taskId);
			// Acknowledge control delivery immediately. Cleanup and lease release continue
			// in the task handler without holding the Stop request open.
			await acknowledgeBackgroundTaskCancellation(taskId).then((task) => {
				if (!task) return;
				void enqueueTaskCleanup(task);
				incrementCounter('athens_background_tasks_cancelled_total', { type: task.type, lane: task.lane });
				const requestedAt = Date.parse(task.cancelRequestedAt || '');
				if (Number.isFinite(requestedAt)) {
					observeHistogram(
						'athens_background_task_cancel_ack_seconds',
						{ type: task.type, lane: task.lane },
						Math.max(0, Date.now() - requestedAt) / 1_000,
					);
				}
			}).catch((error) => {
				console.warn('[background-task] cancellation acknowledgement failed:', error?.message || error);
			});
		})();
	});
}

async function start() {
	stopEventLoopMetrics = startEventLoopDelayMetrics({ role: 'background-worker' });
	await initDataStore();
	const redisReady = await initRedis({ force: true });
	if (!redisReady) throw new Error('Redis is required by the background-task worker');
	await initQdrantCollections().catch((error) => {
		console.warn('[background-task] Qdrant initialization deferred:', error?.message || error);
	});
	await initJobRankingCollection().catch((error) => {
		console.warn('[background-task] Qdrant ranking initialization deferred:', error?.message || error);
	});
	await loadCanonicalSkillDictionary().catch((error) => {
		console.warn('[background-task] canonical skill dictionary warmup failed:', error?.message || error);
	});
	await startControlSubscriber();
	await writeBackgroundWorkerHeartbeat();
	setGauge('athens_background_worker_heartbeat', {}, 1);
	heartbeatTimer = setInterval(() => {
		void writeBackgroundWorkerHeartbeat().catch((error) => {
			console.warn('[background-task] heartbeat failed:', error?.message || error);
		});
		void updateQueueMetrics().catch((error) => {
			console.warn('[background-task] queue metrics failed:', error?.message || error);
		});
	}, 5_000);
	heartbeatTimer.unref?.();

	const laneConcurrency = {
		ai: workerConcurrency('BACKGROUND_AI_TASK_CONCURRENCY', 16),
		io: workerConcurrency('BACKGROUND_IO_TASK_CONCURRENCY', 4),
		pdf: workerConcurrency('BACKGROUND_PDF_TASK_CONCURRENCY', 2),
		cleanup: workerConcurrency('BACKGROUND_CLEANUP_TASK_CONCURRENCY', 2),
	};
	createLaneWorker(TASK_LANES.AI, laneConcurrency.ai);
	createLaneWorker(TASK_LANES.IO, laneConcurrency.io);
	createLaneWorker(TASK_LANES.PDF, laneConcurrency.pdf);
	createLaneWorker(TASK_LANES.CLEANUP, laneConcurrency.cleanup);
	await getBackgroundQueue(TASK_LANES.CLEANUP).add(
		'retention-cleanup',
		{ maintenance: 'retention-cleanup' },
		{
			jobId: 'background-task-retention-cleanup',
			repeat: { every: 60 * 60 * 1_000 },
			removeOnComplete: true,
			removeOnFail: { age: 24 * 60 * 60, count: 100 },
			attempts: 3,
			backoff: { type: 'exponential', delay: 5_000 },
		},
	);
	startAggregateMetricsServer({
		port: Number(process.env.BACKGROUND_WORKER_METRICS_PORT || 9102),
		host: process.env.METRICS_HOST || '0.0.0.0',
	});
	void updateQueueMetrics();
	console.log(`[background-task] worker ready (ai=${laneConcurrency.ai} io=${laneConcurrency.io} pdf=${laneConcurrency.pdf} cleanup=${laneConcurrency.cleanup})`);
}

async function shutdown(signal) {
	if (shuttingDown) return;
	shuttingDown = true;
	console.log(`[background-task] ${signal} — draining workers`);
	const force = setTimeout(() => process.exit(1), 30_000);
	force.unref?.();
	if (heartbeatTimer) clearInterval(heartbeatTimer);
	try {
		await getRedis().del(backgroundTaskKeys.workerHeartbeat);
	} catch {
		// Startup may have been interrupted before Redis connected.
	}
	// Do not translate a deploy/shutdown into a user cancellation. Workers drain
	// normally; if the deadline kills the process, BullMQ's stalled-job recovery
	// resumes the idempotent task in the replacement worker.
	try {
		stopEventLoopMetrics?.();
		await Promise.all(workers.map((worker) => worker.close()));
		setGauge('athens_background_worker_heartbeat', {}, 0);
		if (subscriber?.isOpen) await subscriber.quit();
		await stopAggregateMetricsServer();
		await closeBackgroundQueues();
		await closeRedis();
		await closeDataStore();
	} finally {
		clearTimeout(force);
		process.exit(0);
	}
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

start().catch((error) => {
	console.error('[background-task] startup failed:', error?.stack || error);
	process.exit(1);
});
