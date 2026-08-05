import 'dotenv/config';

import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { DocumentId } from '@nextoffer/shared/document-id';
import { installTerminalLogger } from '@nextoffer/shared/terminal-log';
import { accountInfoCollection, closeDataStore, initDataStore } from '../db/dataStore.js';
import { getFirestoreDb } from '../services/firebase/firebaseAdmin.js';
import { resolveAgentJobDraftPdf } from '../services/agentResumeGenService.js';
import { renderIdentityRefreshedGenerationPdf } from '../services/refreshGeneratedResumesIdentity.js';
import { processBackgroundTask } from '../services/backgroundTasks/taskProcessors.js';
import { runWithBackgroundTaskContext } from '../services/backgroundTasks/taskContext.js';
import {
	cleanupCancelledBackgroundTask,
	cleanupExpiredBackgroundTaskRecords,
} from '../services/backgroundTasks/maintenance.js';
import {
	acknowledgeBackgroundTaskCancellation,
	claimNextBackgroundTask,
	completeBackgroundTask,
	getBackgroundTask,
	isBackgroundTaskCancellationRequested,
	recoverExpiredBackgroundTaskLeases,
	removeBackgroundWorkerHeartbeat,
	renewBackgroundTaskLease,
	retryBackgroundTask,
	writeBackgroundWorkerHeartbeat,
} from '../services/backgroundTasks/taskStore.js';
import {
	BACKGROUND_TASK_STATUS,
	BACKGROUND_TASK_TYPES,
	TASK_LANES,
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

const WORKER_ID = `${os.hostname()}:${process.pid}:${randomUUID()}`;
const POLL_MS = Math.max(100, Number(process.env.BACKGROUND_TASK_POLL_MS || 500));
const LEASE_MS = Math.max(30_000, Number(process.env.BACKGROUND_TASK_LEASE_MS || 120_000));
const LEASE_RENEW_MS = Math.max(10_000, Math.floor(LEASE_MS / 3));
const laneState = new Map();
let heartbeatTimer = null;
let recoveryTimer = null;
let retentionTimer = null;
let stopEventLoopMetrics = null;
let shuttingDown = false;

function workerConcurrency(name, fallback) {
	const value = Number.parseInt(String(process.env[name] || ''), 10);
	return Math.max(1, Number.isFinite(value) ? value : fallback);
}

function cancellationError(message = 'Background task cancelled') {
	return Object.assign(new Error(message), { name: 'AbortError' });
}

function isAbortError(error, signal) {
	return signal?.aborted || error?.name === 'AbortError';
}

function watchCancellation(taskId, controller) {
	const unsubscribe = getFirestoreDb().collection('background_tasks').doc(taskId).onSnapshot((snapshot) => {
		const status = snapshot.data()?.status;
		if ([BACKGROUND_TASK_STATUS.CANCELLING, BACKGROUND_TASK_STATUS.CANCELLED].includes(status)) {
			if (!controller.signal.aborted) controller.abort(cancellationError());
		}
	}, () => undefined);
	return () => unsubscribe();
}

async function resolveTaskApplier(task) {
	if (task.applierName) return task.applierName;
	if (!task.profileId || !DocumentId.isValid(task.profileId)) return '';
	const account = await accountInfoCollection?.findOne(
		{ _id: new DocumentId(task.profileId) },
		{ projection: { name: 1 } },
	);
	return String(account?.name || '');
}

async function processPdfTask(task, signal) {
	const applierName = await resolveTaskApplier(task);
	if (!applierName) throw new Error('Résumé PDF profile was not found');
	if (task.type === BACKGROUND_TASK_TYPES.RENDER_RESUME_PDF) {
		const rendered = await resolveAgentJobDraftPdf({
			applierName,
			jobId: String(task.payload?.jobId || ''),
			signal,
		});
		if (!rendered?.buffer?.length || !rendered?.draftPath) {
			throw new Error('Saved résumé could not be rendered as PDF');
		}
		return {
			progress: { total: 1, completed: 1, failed: 0, active: 0, phase: 'completed' },
			result: { draftPath: rendered.draftPath, byteLength: rendered.buffer.length },
		};
	}
	if (task.type === BACKGROUND_TASK_TYPES.RENDER_RESUME_IDENTITY_PDF) {
		const rendered = await renderIdentityRefreshedGenerationPdf({
			applierName,
			generationId: String(task.payload?.generationId || ''),
			jobId: String(task.payload?.jobId || ''),
			signal,
		});
		if (!rendered?.buffer?.length || !rendered?.draftPath) {
			throw new Error('Identity-refreshed résumé could not be rendered as PDF');
		}
		return {
			progress: { total: 1, completed: 1, failed: 0, active: 0, phase: 'completed' },
			result: { draftPath: rendered.draftPath, byteLength: rendered.buffer.length },
		};
	}
	return null;
}

async function executeTask(task) {
	const startedAt = Date.now();
	const labels = { type: task.type, lane: task.lane };
	const controller = new AbortController();
	const stopCancellationWatch = watchCancellation(task.id, controller);
	const leaseTimer = setInterval(() => {
		void renewBackgroundTaskLease(task.id, {
			workerId: WORKER_ID,
			leaseToken: task.leaseToken,
			leaseMs: LEASE_MS,
		}).then((renewed) => {
			if (!renewed && !controller.signal.aborted) controller.abort(cancellationError('Background task lease was lost'));
		}).catch(() => {
			if (!controller.signal.aborted) controller.abort(cancellationError('Background task lease could not be renewed'));
		});
	}, LEASE_RENEW_MS);
	leaseTimer.unref?.();

	try {
		incrementCounter('athens_background_tasks_started_total', labels);
		const queuedAt = Date.parse(task.createdAt || '');
		if (Number.isFinite(queuedAt)) {
			observeHistogram('athens_background_task_queue_age_seconds', labels, Math.max(0, startedAt - queuedAt) / 1_000);
		}
		if (await isBackgroundTaskCancellationRequested(task.id)) throw cancellationError();
		const output = await runWithBackgroundTaskContext(task.id, async () => (
			await processPdfTask(task, controller.signal)
			|| processBackgroundTask(task, controller.signal)
		));
		if (controller.signal.aborted || await isBackgroundTaskCancellationRequested(task.id)) throw cancellationError();
		await completeBackgroundTask(task.id, output || {});
		incrementCounter('athens_background_tasks_completed_total', labels);
		observeHistogram('athens_background_task_duration_seconds', labels, (Date.now() - startedAt) / 1_000);
	} catch (error) {
		if (isAbortError(error, controller.signal) || await isBackgroundTaskCancellationRequested(task.id)) {
			const cancelled = await acknowledgeBackgroundTaskCancellation(task.id);
			if (cancelled) await cleanupCancelledBackgroundTask(cancelled).catch(() => undefined);
			incrementCounter('athens_background_tasks_cancelled_total', labels);
			return;
		}
		const delayMs = Math.min(60_000, 1_000 * (2 ** Math.max(0, task.attempt - 1)));
		const next = await retryBackgroundTask(task.id, error, { delayMs });
		if (next?.status === BACKGROUND_TASK_STATUS.FAILED) {
			incrementCounter('athens_background_tasks_failed_total', labels);
			console.error(`[background-task] ${task.id} failed:`, error?.stack || error);
		} else {
			console.warn(`[background-task] ${task.id} retrying:`, error?.message || error);
		}
	} finally {
		clearInterval(leaseTimer);
		stopCancellationWatch();
	}
}

async function pollLane(state) {
	if (shuttingDown || state.polling || state.active >= state.concurrency) return;
	state.polling = true;
	try {
		while (!shuttingDown && state.active < state.concurrency) {
			const task = await claimNextBackgroundTask({ lane: state.lane, workerId: WORKER_ID, leaseMs: LEASE_MS });
			if (!task) break;
			state.active += 1;
			setGauge('athens_background_queue_jobs', { lane: state.lane, state: 'active' }, state.active);
			void executeTask(task).finally(() => {
				state.active -= 1;
				setGauge('athens_background_queue_jobs', { lane: state.lane, state: 'active' }, state.active);
				void pollLane(state);
			});
		}
	} catch (error) {
		console.warn(`[background-task] ${state.lane} poll failed:`, error?.message || error);
	} finally {
		state.polling = false;
	}
}

function startLane(lane, concurrency) {
	const state = { lane, concurrency, active: 0, polling: false, timer: null };
	state.timer = setInterval(() => void pollLane(state), POLL_MS);
	state.timer.unref?.();
	laneState.set(lane, state);
	void pollLane(state);
}

async function start() {
	stopEventLoopMetrics = startEventLoopDelayMetrics({ role: 'background-worker' });
	await initDataStore();
	const concurrency = {
		[TASK_LANES.AI]: workerConcurrency('BACKGROUND_AI_TASK_CONCURRENCY', 4),
		[TASK_LANES.IO]: workerConcurrency('BACKGROUND_IO_TASK_CONCURRENCY', 4),
		[TASK_LANES.PDF]: workerConcurrency('BACKGROUND_PDF_TASK_CONCURRENCY', 2),
		[TASK_LANES.CLEANUP]: workerConcurrency('BACKGROUND_CLEANUP_TASK_CONCURRENCY', 1),
	};
	for (const [lane, count] of Object.entries(concurrency)) startLane(lane, count);
	const lanes = Object.keys(concurrency);
	await writeBackgroundWorkerHeartbeat({ workerId: WORKER_ID, lanes });
	heartbeatTimer = setInterval(() => {
		void writeBackgroundWorkerHeartbeat({ workerId: WORKER_ID, lanes }).catch((error) => {
			console.warn('[background-task] heartbeat failed:', error?.message || error);
		});
	}, 5_000);
	heartbeatTimer.unref?.();
	recoveryTimer = setInterval(() => {
		void recoverExpiredBackgroundTaskLeases().catch((error) => {
			console.warn('[background-task] lease recovery failed:', error?.message || error);
		});
	}, 30_000);
	recoveryTimer.unref?.();
	retentionTimer = setInterval(() => {
		void cleanupExpiredBackgroundTaskRecords().catch((error) => {
			console.warn('[background-task] retention cleanup failed:', error?.message || error);
		});
	}, 60 * 60 * 1_000);
	retentionTimer.unref?.();
	startAggregateMetricsServer({
		port: Number(process.env.BACKGROUND_WORKER_METRICS_PORT || 9102),
		host: process.env.METRICS_HOST || '0.0.0.0',
	});
	setGauge('athens_background_worker_heartbeat', {}, 1);
	console.log(`[background-task] Firestore worker ready (${Object.entries(concurrency).map(([lane, count]) => `${lane}=${count}`).join(' ')})`);
}

async function shutdown(signal) {
	if (shuttingDown) return;
	shuttingDown = true;
	console.log(`[background-task] ${signal} — draining Firestore tasks`);
	for (const state of laneState.values()) clearInterval(state.timer);
	if (heartbeatTimer) clearInterval(heartbeatTimer);
	if (recoveryTimer) clearInterval(recoveryTimer);
	if (retentionTimer) clearInterval(retentionTimer);
	const deadline = Date.now() + 30_000;
	while ([...laneState.values()].some((state) => state.active > 0) && Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	await removeBackgroundWorkerHeartbeat(WORKER_ID);
	setGauge('athens_background_worker_heartbeat', {}, 0);
	stopEventLoopMetrics?.();
	await stopAggregateMetricsServer();
	await closeDataStore();
	process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

start().catch((error) => {
	console.error('[background-task] startup failed:', error?.stack || error);
	process.exit(1);
});
