import { createHash, randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { getFirestoreDb } from '../firebase/firebaseAdmin.js';
import {
	ACTIVE_TASK_STATUSES,
	BACKGROUND_TASK_STATUS,
	SINGLETON_TASK_TYPES,
	TERMINAL_TASK_STATUSES,
	laneForTaskType,
	publicTaskSnapshot,
} from './taskTypes.js';
import { incrementCounter } from '../monitoring/metrics.js';

const TASKS = 'background_tasks';
const RESERVATIONS = 'background_task_reservations';
const WORKERS = 'worker_leases';
const DEFAULT_RETENTION_SECONDS = 7 * 24 * 60 * 60;
const DEFAULT_LEASE_MS = 2 * 60 * 1_000;
const WORKER_HEARTBEAT_MAX_AGE_MS = Math.max(
	5_000,
	Number.parseInt(String(process.env.BACKGROUND_WORKER_HEARTBEAT_MAX_AGE_MS || ''), 10) || 20_000,
);

function clean(value) {
	return String(value ?? '').trim();
}

function nowDate() {
	return new Date();
}

function nowIso() {
	return nowDate().toISOString();
}

function retentionSeconds() {
	return Math.max(
		60 * 60,
		Number.parseInt(String(process.env.BACKGROUND_TASK_RETENTION_SECONDS || ''), 10)
			|| DEFAULT_RETENTION_SECONDS,
	);
}

function leaseDurationMs() {
	return Math.max(
		30_000,
		Number.parseInt(String(process.env.BACKGROUND_TASK_LEASE_MS || ''), 10) || DEFAULT_LEASE_MS,
	);
}

function asDate(value) {
	if (!value) return null;
	if (value instanceof Date) return value;
	if (typeof value?.toDate === 'function') return value.toDate();
	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function asIso(value) {
	return asDate(value)?.toISOString() || null;
}

function reservationId(kind, ...parts) {
	return createHash('sha256')
		.update([kind, ...parts.map(clean)].join('\0'))
		.digest('hex');
}

function taskRef(taskId) {
	return getFirestoreDb().collection(TASKS).doc(clean(taskId));
}

function publicStoredTask(id, data = {}) {
	if (!id || !data) return null;
	return {
		id: String(id),
		requestId: data.requestId || null,
		type: data.type,
		lane: data.lane,
		status: data.status,
		profileId: data.profileId,
		applierName: data.applierName || '',
		ownerUid: data.ownerUid || null,
		payload: data.payload || {},
		progress: data.progress || {},
		result: data.result ?? null,
		error: data.error || null,
		priority: Number(data.priority || 0),
		attempt: Number(data.attempt || 0),
		maxAttempts: Math.max(1, Number(data.maxAttempts || 3)),
		availableAt: asIso(data.availableAt),
		leaseOwner: data.leaseOwner || null,
		leaseToken: data.leaseToken || null,
		leaseExpiresAt: asIso(data.leaseExpiresAt),
		heartbeatAt: asIso(data.heartbeatAt),
		parentTaskId: data.parentTaskId || null,
		lastEvent: data.lastEvent || null,
		eventSequence: Number(data.eventSequence || 0),
		createdAt: asIso(data.createdAt) || nowIso(),
		startedAt: asIso(data.startedAt),
		cancelRequestedAt: asIso(data.cancelRequestedAt),
		cancelAcknowledgedAt: asIso(data.cancelAcknowledgedAt),
		finishedAt: asIso(data.finishedAt),
		updatedAt: asIso(data.updatedAt) || asIso(data.createdAt) || nowIso(),
		expiresAt: asIso(data.expiresAt),
	};
}

function snapshotTask(snapshot) {
	return snapshot?.exists ? publicStoredTask(snapshot.id, snapshot.data()) : null;
}

function storedTask(task, { availableAt = nowDate() } = {}) {
	const createdAt = asDate(task.createdAt) || nowDate();
	const expiresAt = new Date(createdAt.getTime() + retentionSeconds() * 1_000);
	return {
		requestId: task.requestId || null,
		type: task.type,
		lane: task.lane,
		status: task.status,
		profileId: task.profileId,
		applierName: task.applierName || '',
		ownerUid: task.ownerUid || null,
		payload: task.payload || {},
		progress: task.progress || {},
		result: task.result ?? null,
		error: task.error || null,
		priority: Number(task.priority || 0),
		attempt: Number(task.attempt || 0),
		maxAttempts: Math.max(1, Number(task.maxAttempts || 3)),
		availableAt: asDate(task.availableAt) || availableAt,
		leaseOwner: task.leaseOwner || null,
		leaseToken: task.leaseToken || null,
		leaseExpiresAt: asDate(task.leaseExpiresAt),
		heartbeatAt: asDate(task.heartbeatAt),
		parentTaskId: task.parentTaskId || null,
		lastEvent: task.lastEvent || null,
		eventSequence: Number(task.eventSequence || 0),
		createdAt,
		startedAt: asDate(task.startedAt),
		cancelRequestedAt: asDate(task.cancelRequestedAt),
		cancelAcknowledgedAt: asDate(task.cancelAcknowledgedAt),
		finishedAt: asDate(task.finishedAt),
		updatedAt: asDate(task.updatedAt) || createdAt,
		expiresAt,
	};
}

function reservationExpired(data, at = Date.now()) {
	const expiresAt = asDate(data?.expiresAt)?.getTime() || 0;
	return expiresAt <= at;
}

function terminal(status) {
	return TERMINAL_TASK_STATUSES.has(String(status || ''));
}

function active(status) {
	return ACTIVE_TASK_STATUSES.has(String(status || ''));
}

function transitionAllowed(current, next) {
	if (!next || next === current) return true;
	if (terminal(current)) return false;
	if (next === BACKGROUND_TASK_STATUS.RUNNING) return current === BACKGROUND_TASK_STATUS.QUEUED;
	if (next === BACKGROUND_TASK_STATUS.CANCELLING) return current === BACKGROUND_TASK_STATUS.RUNNING;
	if (next === BACKGROUND_TASK_STATUS.CANCELLED) {
		return current === BACKGROUND_TASK_STATUS.CANCELLING || current === BACKGROUND_TASK_STATUS.QUEUED;
	}
	if ([
		BACKGROUND_TASK_STATUS.COMPLETED,
		BACKGROUND_TASK_STATUS.COMPLETED_WITH_ERRORS,
		BACKGROUND_TASK_STATUS.FAILED,
	].includes(next)) return current === BACKGROUND_TASK_STATUS.RUNNING;
	return false;
}

async function deleteSingletonReservation(transaction, task) {
	if (!task || !SINGLETON_TASK_TYPES.has(task.type)) return;
	const ref = getFirestoreDb().collection(RESERVATIONS).doc(
		reservationId('singleton', task.profileId, task.type),
	);
	const snapshot = await transaction.get(ref);
	if (snapshot.exists && String(snapshot.data()?.taskId || '') === task.id) transaction.delete(ref);
}

export async function flushBackgroundTaskMirrors() {
	// Firestore is authoritative; there is no asynchronous mirror to flush.
}

export async function getBackgroundWorkerHealth() {
	const now = nowDate();
	try {
		const snapshot = await getFirestoreDb().collection(WORKERS)
			.where('expiresAt', '>', now)
			.orderBy('expiresAt', 'desc')
			.limit(1)
			.get();
		const worker = snapshot.docs[0]?.data();
		const heartbeatAt = asDate(worker?.heartbeatAt);
		const ageMs = heartbeatAt ? Date.now() - heartbeatAt.getTime() : Infinity;
		return {
			ready: Boolean(worker) && ageMs <= WORKER_HEARTBEAT_MAX_AGE_MS,
			workerId: snapshot.docs[0]?.id || null,
			heartbeatAt: heartbeatAt?.toISOString() || null,
			ageMs: Number.isFinite(ageMs) ? ageMs : null,
			lanes: Array.isArray(worker?.lanes) ? worker.lanes : [],
		};
	} catch (error) {
		return { ready: false, reason: 'firestore_unavailable', error: error?.message || String(error) };
	}
}

export async function requireBackgroundWorker() {
	const health = await getBackgroundWorkerHealth();
	if (!health.ready) {
		const error = new Error('Background worker is unavailable; no task was started');
		error.status = 503;
		error.code = 'BACKGROUND_WORKER_UNAVAILABLE';
		error.health = health;
		throw error;
	}
	return health;
}

export async function writeBackgroundWorkerHeartbeat({ workerId = `worker-${process.pid}`, lanes = [] } = {}) {
	const heartbeatAt = nowDate();
	await getFirestoreDb().collection(WORKERS).doc(clean(workerId)).set({
		workerId: clean(workerId),
		lanes: [...new Set((Array.isArray(lanes) ? lanes : []).map(clean).filter(Boolean))],
		heartbeatAt,
		expiresAt: new Date(heartbeatAt.getTime() + Math.max(30_000, WORKER_HEARTBEAT_MAX_AGE_MS * 2)),
		updatedAt: heartbeatAt,
	}, { merge: true });
	return { workerId: clean(workerId), heartbeatAt: heartbeatAt.toISOString() };
}

export async function removeBackgroundWorkerHeartbeat(workerId) {
	if (!clean(workerId)) return false;
	await getFirestoreDb().collection(WORKERS).doc(clean(workerId)).delete().catch(() => undefined);
	return true;
}

export async function createBackgroundTask({
	requestId,
	type,
	profileId,
	applierName,
	ownerUid,
	payload = {},
	progress = {},
	priority = 0,
	maxAttempts = 3,
	availableAt = null,
	parentTaskId = null,
	skipWorkerCheck = false,
}) {
	if (!skipWorkerCheck) await requireBackgroundWorker();
	const normalizedProfileId = clean(profileId) || clean(applierName).toLocaleLowerCase('en-US');
	const normalizedRequestId = clean(requestId) || randomUUID();
	const lane = laneForTaskType(type);
	if (!lane) throw Object.assign(new Error(`Unsupported background task type: ${type}`), { status: 400 });
	if (!normalizedProfileId) throw Object.assign(new Error('profileId or applierName is required'), { status: 400 });

	const firestore = getFirestoreDb();
	const id = randomUUID();
	const createdAt = nowDate();
	const reservationExpiresAt = new Date(createdAt.getTime() + retentionSeconds() * 1_000);
	const requestReservationRef = firestore.collection(RESERVATIONS).doc(
		reservationId('request', normalizedProfileId, normalizedRequestId),
	);
	const singletonReservationRef = SINGLETON_TASK_TYPES.has(type)
		? firestore.collection(RESERVATIONS).doc(reservationId('singleton', normalizedProfileId, type))
		: null;
	const newTask = {
		id,
		requestId: normalizedRequestId,
		type,
		lane,
		status: BACKGROUND_TASK_STATUS.QUEUED,
		profileId: normalizedProfileId,
		applierName: clean(applierName),
		ownerUid: clean(ownerUid) || null,
		payload,
		progress: {
			total: null,
			completed: 0,
			failed: 0,
			cancelled: 0,
			active: 0,
			...progress,
		},
		result: null,
		error: null,
		priority: Number(priority || 0),
		attempt: 0,
		maxAttempts: Math.max(1, Number(maxAttempts || 3)),
		availableAt: asDate(availableAt) || createdAt,
		parentTaskId: clean(parentTaskId) || null,
		createdAt,
		updatedAt: createdAt,
	};

	const outcome = await firestore.runTransaction(async (transaction) => {
		const requestReservation = await transaction.get(requestReservationRef);
		if (requestReservation.exists && !reservationExpired(requestReservation.data())) {
			const existingId = clean(requestReservation.data()?.taskId);
			if (existingId) {
				const existing = await transaction.get(firestore.collection(TASKS).doc(existingId));
				if (existing.exists) return { task: snapshotTask(existing), created: false, duplicate: true };
			}
		}

		if (singletonReservationRef) {
			const singletonReservation = await transaction.get(singletonReservationRef);
			if (singletonReservation.exists && !reservationExpired(singletonReservation.data())) {
				const existingId = clean(singletonReservation.data()?.taskId);
				if (existingId) {
					const existing = await transaction.get(firestore.collection(TASKS).doc(existingId));
					const existingTask = snapshotTask(existing);
					if (existingTask && active(existingTask.status)) {
						transaction.set(requestReservationRef, {
							kind: 'request', profileId: normalizedProfileId, requestId: normalizedRequestId,
							taskId: existingTask.id, createdAt, updatedAt: createdAt, expiresAt: reservationExpiresAt,
						}, { merge: false });
						return { task: existingTask, created: false, alreadyActive: true };
					}
				}
			}
		}

		transaction.create(firestore.collection(TASKS).doc(id), storedTask(newTask));
		transaction.set(requestReservationRef, {
			kind: 'request', profileId: normalizedProfileId, requestId: normalizedRequestId,
			taskId: id, createdAt, updatedAt: createdAt, expiresAt: reservationExpiresAt,
		}, { merge: false });
		if (singletonReservationRef) {
			transaction.set(singletonReservationRef, {
				kind: 'singleton', profileId: normalizedProfileId, type, taskId: id,
				createdAt, updatedAt: createdAt, expiresAt: reservationExpiresAt,
			}, { merge: false });
		}
		return { task: publicStoredTask(id, storedTask(newTask)), created: true };
	});

	if (outcome.created) incrementCounter('athens_background_tasks_enqueued_total', { type, lane });
	return outcome;
}

export async function getBackgroundTask(taskId) {
	if (!clean(taskId)) return null;
	return snapshotTask(await taskRef(taskId).get());
}

export async function listBackgroundTasks(profileId, { activeOnly = false, limit = 100 } = {}) {
	const take = Math.max(1, Math.min(500, Number(limit || 100)));
	let query = getFirestoreDb().collection(TASKS).where('profileId', '==', clean(profileId));
	if (activeOnly) query = query.where('status', 'in', [...ACTIVE_TASK_STATUSES]);
	const snapshot = await query.limit(Math.max(take, activeOnly ? take * 2 : take)).get();
	return snapshot.docs
		.map(snapshotTask)
		.filter((task) => task && (!activeOnly || active(task.status)))
		.sort((left, right) => Date.parse(right.createdAt || 0) - Date.parse(left.createdAt || 0))
		.slice(0, take);
}

export async function findActiveBackgroundTask(profileId, type) {
	const tasks = await listBackgroundTasks(profileId, { activeOnly: true, limit: 100 });
	return tasks.find((task) => task.type === type) || null;
}

export async function updateBackgroundTask(taskId, patch, {
	eventType = 'task-updated',
	eventData = {},
	includeTaskSnapshot: _includeTaskSnapshot = true,
} = {}) {
	const firestore = getFirestoreDb();
	const ref = firestore.collection(TASKS).doc(clean(taskId));
	return firestore.runTransaction(async (transaction) => {
		const snapshot = await transaction.get(ref);
		if (!snapshot.exists) throw new Error(`Background task ${taskId} not found`);
		const current = snapshotTask(snapshot);
		if (patch.status && !transitionAllowed(current.status, patch.status)) return current;
		if (!patch.status && current.status !== BACKGROUND_TASK_STATUS.RUNNING) return current;

		const at = nowDate();
		const next = {
			...current,
			...patch,
			progress: patch.progress ? { ...current.progress, ...patch.progress } : current.progress,
			updatedAt: at.toISOString(),
		};
		const update = {
			updatedAt: at,
			lastEvent: { type: eventType, at: at.toISOString(), ...eventData },
			eventSequence: FieldValue.increment(1),
		};
		for (const field of ['status', 'error', 'result', 'progress', 'leaseOwner', 'leaseToken']) {
			if (Object.hasOwn(patch, field)) update[field] = patch[field] ?? null;
		}
		for (const field of [
			'startedAt', 'cancelRequestedAt', 'cancelAcknowledgedAt', 'finishedAt',
			'leaseExpiresAt', 'heartbeatAt', 'availableAt',
		]) {
			if (Object.hasOwn(patch, field)) update[field] = asDate(patch[field]);
		}
		if (patch.status && terminal(patch.status)) {
			update.expiresAt = new Date(at.getTime() + retentionSeconds() * 1_000);
			update.leaseOwner = null;
			update.leaseToken = null;
			update.leaseExpiresAt = null;
			await deleteSingletonReservation(transaction, current);
		}
		transaction.update(ref, update);
		return { ...next, eventSequence: current.eventSequence + 1, lastEvent: update.lastEvent };
	});
}

export async function claimNextBackgroundTask({ lane, workerId, leaseMs = leaseDurationMs() }) {
	const firestore = getFirestoreDb();
	const now = nowDate();
	const candidates = await firestore.collection(TASKS)
		.where('status', '==', BACKGROUND_TASK_STATUS.QUEUED)
		.where('lane', '==', clean(lane))
		.where('availableAt', '<=', now)
		.orderBy('availableAt', 'asc')
		.orderBy('priority', 'desc')
		.orderBy('createdAt', 'asc')
		.limit(10)
		.get();
	for (const candidate of candidates.docs) {
		const token = randomUUID();
		const claimed = await firestore.runTransaction(async (transaction) => {
			const snapshot = await transaction.get(candidate.ref);
			if (!snapshot.exists || snapshot.data()?.status !== BACKGROUND_TASK_STATUS.QUEUED) return null;
			const at = nowDate();
			const currentAttempt = Number(snapshot.data()?.attempt || 0);
			transaction.update(candidate.ref, {
				status: BACKGROUND_TASK_STATUS.RUNNING,
				attempt: currentAttempt + 1,
				startedAt: snapshot.data()?.startedAt || at,
				leaseOwner: clean(workerId),
				leaseToken: token,
				leaseExpiresAt: new Date(at.getTime() + Math.max(30_000, Number(leaseMs || DEFAULT_LEASE_MS))),
				heartbeatAt: at,
				updatedAt: at,
				lastEvent: { type: 'task-started', at: at.toISOString() },
				eventSequence: FieldValue.increment(1),
			});
			return publicStoredTask(snapshot.id, {
				...snapshot.data(),
				status: BACKGROUND_TASK_STATUS.RUNNING,
				attempt: currentAttempt + 1,
				startedAt: snapshot.data()?.startedAt || at,
				leaseOwner: clean(workerId),
				leaseToken: token,
				leaseExpiresAt: new Date(at.getTime() + Math.max(30_000, Number(leaseMs || DEFAULT_LEASE_MS))),
				heartbeatAt: at,
				updatedAt: at,
			});
		});
		if (claimed) return claimed;
	}
	return null;
}

export async function renewBackgroundTaskLease(taskId, { workerId, leaseToken, leaseMs = leaseDurationMs() }) {
	const firestore = getFirestoreDb();
	const ref = firestore.collection(TASKS).doc(clean(taskId));
	return firestore.runTransaction(async (transaction) => {
		const snapshot = await transaction.get(ref);
		if (!snapshot.exists) return false;
		const data = snapshot.data();
		if (
			data.status !== BACKGROUND_TASK_STATUS.RUNNING
			|| clean(data.leaseOwner) !== clean(workerId)
			|| clean(data.leaseToken) !== clean(leaseToken)
		) return false;
		const at = nowDate();
		transaction.update(ref, {
			heartbeatAt: at,
			leaseExpiresAt: new Date(at.getTime() + Math.max(30_000, Number(leaseMs || DEFAULT_LEASE_MS))),
			updatedAt: at,
		});
		return true;
	});
}

export async function retryBackgroundTask(taskId, error, { delayMs = 1_000 } = {}) {
	const firestore = getFirestoreDb();
	const ref = firestore.collection(TASKS).doc(clean(taskId));
	return firestore.runTransaction(async (transaction) => {
		const snapshot = await transaction.get(ref);
		if (!snapshot.exists) return null;
		const task = snapshotTask(snapshot);
		if (task.status !== BACKGROUND_TASK_STATUS.RUNNING) return task;
		if (task.attempt >= task.maxAttempts) {
			const at = nowDate();
			await deleteSingletonReservation(transaction, task);
			transaction.update(ref, {
				status: BACKGROUND_TASK_STATUS.FAILED,
				error: error instanceof Error ? error.message : String(error),
				finishedAt: at,
				updatedAt: at,
				leaseOwner: null,
				leaseToken: null,
				leaseExpiresAt: null,
				expiresAt: new Date(at.getTime() + retentionSeconds() * 1_000),
			});
			return { ...task, status: BACKGROUND_TASK_STATUS.FAILED, finishedAt: at.toISOString() };
		}
		const at = nowDate();
		transaction.update(ref, {
			status: BACKGROUND_TASK_STATUS.QUEUED,
			error: error instanceof Error ? error.message : String(error),
			availableAt: new Date(at.getTime() + Math.max(250, Number(delayMs || 1_000))),
			updatedAt: at,
			leaseOwner: null,
			leaseToken: null,
			leaseExpiresAt: null,
			heartbeatAt: null,
			lastEvent: { type: 'task-retrying', at: at.toISOString(), attempt: task.attempt },
			eventSequence: FieldValue.increment(1),
		});
		return { ...task, status: BACKGROUND_TASK_STATUS.QUEUED, updatedAt: at.toISOString() };
	});
}

export async function recoverExpiredBackgroundTaskLeases({ limit = 100 } = {}) {
	const firestore = getFirestoreDb();
	const now = nowDate();
	const snapshot = await firestore.collection(TASKS)
		.where('status', '==', BACKGROUND_TASK_STATUS.RUNNING)
		.where('leaseExpiresAt', '<=', now)
		.orderBy('leaseExpiresAt', 'asc')
		.limit(Math.max(1, Math.min(500, Number(limit || 100))))
		.get();
	let recovered = 0;
	for (const document of snapshot.docs) {
		const result = await retryBackgroundTask(document.id, new Error('Worker lease expired'), { delayMs: 250 });
		if (result) recovered += 1;
	}
	return { recovered };
}

export async function markBackgroundTaskRunning(taskId) {
	const task = await getBackgroundTask(taskId);
	if (!task) throw new Error(`Background task ${taskId} not found`);
	if (task.status === BACKGROUND_TASK_STATUS.CANCELLING || await isBackgroundTaskCancellationRequested(taskId)) {
		return acknowledgeBackgroundTaskCancellation(taskId);
	}
	if (task.status !== BACKGROUND_TASK_STATUS.QUEUED) return task;
	return updateBackgroundTask(taskId, {
		status: BACKGROUND_TASK_STATUS.RUNNING,
		startedAt: nowDate(),
	}, { eventType: 'task-started' });
}

export async function completeBackgroundTask(taskId, { result = null, progress = null } = {}) {
	if (await isBackgroundTaskCancellationRequested(taskId)) {
		return acknowledgeBackgroundTaskCancellation(taskId, { progress });
	}
	const task = await getBackgroundTask(taskId);
	const failed = Number(progress?.failed ?? task?.progress?.failed ?? 0);
	return updateBackgroundTask(taskId, {
		status: failed > 0
			? BACKGROUND_TASK_STATUS.COMPLETED_WITH_ERRORS
			: BACKGROUND_TASK_STATUS.COMPLETED,
		...(progress ? { progress } : {}),
		result,
		finishedAt: nowDate(),
	}, { eventType: 'task-completed' });
}

export async function failBackgroundTask(taskId, error) {
	if (await isBackgroundTaskCancellationRequested(taskId)) {
		return acknowledgeBackgroundTaskCancellation(taskId);
	}
	return updateBackgroundTask(taskId, {
		status: BACKGROUND_TASK_STATUS.FAILED,
		error: error instanceof Error ? error.message : String(error),
		finishedAt: nowDate(),
	}, { eventType: 'task-failed' });
}

export async function requestBackgroundTaskCancellation(taskId) {
	const firestore = getFirestoreDb();
	const ref = firestore.collection(TASKS).doc(clean(taskId));
	return firestore.runTransaction(async (transaction) => {
		const snapshot = await transaction.get(ref);
		if (!snapshot.exists) return null;
		const task = snapshotTask(snapshot);
		if (terminal(task.status)) return task;
		const at = nowDate();
		const queued = task.status === BACKGROUND_TASK_STATUS.QUEUED;
		const status = queued ? BACKGROUND_TASK_STATUS.CANCELLED : BACKGROUND_TASK_STATUS.CANCELLING;
		if (queued) await deleteSingletonReservation(transaction, task);
		transaction.update(ref, {
			status,
			cancelRequestedAt: at,
			...(queued ? { cancelAcknowledgedAt: at, finishedAt: at } : {}),
			updatedAt: at,
			lastEvent: { type: queued ? 'task-cancelled' : 'task-cancel-requested', at: at.toISOString() },
			eventSequence: FieldValue.increment(1),
			...(queued ? { expiresAt: new Date(at.getTime() + retentionSeconds() * 1_000) } : {}),
		});
		incrementCounter('athens_background_task_cancel_requests_total', { type: task.type, lane: task.lane });
		return {
			...task,
			status,
			cancelRequestedAt: at.toISOString(),
			...(queued ? { cancelAcknowledgedAt: at.toISOString(), finishedAt: at.toISOString() } : {}),
			updatedAt: at.toISOString(),
		};
	});
}

export async function acknowledgeBackgroundTaskCancellation(taskId, { progress = null } = {}) {
	const task = await getBackgroundTask(taskId);
	if (!task) return null;
	if (task.status === BACKGROUND_TASK_STATUS.CANCELLED) return task;
	if (task.status !== BACKGROUND_TASK_STATUS.CANCELLING) return task;
	const at = nowDate();
	return updateBackgroundTask(taskId, {
		status: BACKGROUND_TASK_STATUS.CANCELLED,
		...(progress ? { progress } : {}),
		cancelAcknowledgedAt: at,
		finishedAt: at,
	}, { eventType: 'task-cancelled' });
}

export async function isBackgroundTaskCancellationRequested(taskId) {
	const task = await getBackgroundTask(taskId);
	return Boolean(task && (
		task.status === BACKGROUND_TASK_STATUS.CANCELLING
		|| task.status === BACKGROUND_TASK_STATUS.CANCELLED
		|| task.cancelRequestedAt
	));
}

export async function releaseSingletonTask(task) {
	if (!task || !SINGLETON_TASK_TYPES.has(task.type)) return;
	const firestore = getFirestoreDb();
	await firestore.runTransaction(async (transaction) => deleteSingletonReservation(transaction, task));
}

export async function publishBackgroundTaskItemEvent(taskId, eventType, data) {
	const firestore = getFirestoreDb();
	const ref = firestore.collection(TASKS).doc(clean(taskId));
	return firestore.runTransaction(async (transaction) => {
		const snapshot = await transaction.get(ref);
		if (!snapshot.exists || snapshot.data()?.status !== BACKGROUND_TASK_STATUS.RUNNING) return null;
		const at = nowDate();
		transaction.update(ref, {
			lastEvent: { type: clean(eventType) || 'task-item', at: at.toISOString(), data },
			eventSequence: FieldValue.increment(1),
			updatedAt: at,
		});
		return `${Date.now()}-${Number(snapshot.data()?.eventSequence || 0) + 1}`;
	});
}

export async function waitForBackgroundTask(taskId, { signal, timeoutMs = 10 * 60 * 1_000 } = {}) {
	const ref = taskRef(taskId);
	return new Promise((resolve, reject) => {
		let settled = false;
		let unsubscribe = () => {};
		const finish = (operation, value) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			signal?.removeEventListener('abort', aborted);
			unsubscribe();
			operation(value);
		};
		const aborted = () => {
			void requestBackgroundTaskCancellation(taskId).catch(() => undefined);
			finish(reject, signal?.reason instanceof Error
				? signal.reason
				: Object.assign(new Error('Background task cancelled'), { name: 'AbortError' }));
		};
		const timer = setTimeout(() => {
			finish(reject, Object.assign(new Error('Background task timed out'), { code: 'BACKGROUND_TASK_TIMEOUT' }));
		}, Math.max(1_000, Number(timeoutMs || 0)));
		timer.unref?.();
		if (signal?.aborted) return aborted();
		signal?.addEventListener('abort', aborted, { once: true });
		unsubscribe = ref.onSnapshot((snapshot) => {
			const task = snapshotTask(snapshot);
			if (!task || !terminal(task.status)) return;
			if ([BACKGROUND_TASK_STATUS.COMPLETED, BACKGROUND_TASK_STATUS.COMPLETED_WITH_ERRORS].includes(task.status)) {
				finish(resolve, task.result);
			} else {
				const error = Object.assign(new Error(task.error || `Background task ${task.status}`), {
					name: task.status === BACKGROUND_TASK_STATUS.CANCELLED ? 'AbortError' : 'Error',
					status: task.status,
				});
				finish(reject, error);
			}
		}, (error) => finish(reject, error));
	});
}

export const backgroundTaskStoreTest = {
	publicStoredTask,
	storedTask,
	reservationId,
	transitionAllowed,
};
