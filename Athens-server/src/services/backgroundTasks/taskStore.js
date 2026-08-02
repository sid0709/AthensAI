import { randomUUID } from 'node:crypto';
import { backgroundTasksCollection } from '../../db/dataStore.js';
import { getRedis, isRedisReady } from '../../db/redis.js';
import { getBackgroundQueue } from './bullConnection.js';
import {
	BACKGROUND_EVENT_STREAM_MAX_LENGTH,
	BACKGROUND_TASK_RETENTION_SECONDS,
	backgroundTaskKeys,
} from './redisKeys.js';
import {
	ACTIVE_TASK_STATUSES,
	BACKGROUND_TASK_STATUS,
	SINGLETON_TASK_TYPES,
	TERMINAL_TASK_STATUSES,
	laneForTaskType,
	publicTaskSnapshot,
} from './taskTypes.js';
import { incrementCounter } from '../monitoring/metrics.js';
import { firestoreMutationLimiter } from './resourceLimits.js';

const WORKER_HEARTBEAT_MAX_AGE_MS = Math.max(
	5_000,
	Number.parseInt(String(process.env.BACKGROUND_WORKER_HEARTBEAT_MAX_AGE_MS || ''), 10) || 20_000,
);
const FIRESTORE_MIRROR_INTERVAL_MS = Math.max(
	250,
	Number.parseInt(String(process.env.BACKGROUND_TASK_MIRROR_INTERVAL_MS || ''), 10) || 1_000,
);
const mirrorTimers = new Map();
const mirrorLatest = new Map();
const mirrorChains = new Map();

function nowIso() {
	return new Date().toISOString();
}

function json(value, fallback) {
	try {
		return JSON.parse(value || '');
	} catch {
		return fallback;
	}
}

function clean(value) {
	return String(value ?? '').trim();
}

function parseTaskHash(hash) {
	if (!hash?.id) return null;
	return {
		id: hash.id,
		requestId: hash.requestId || null,
		type: hash.type,
		lane: hash.lane,
		status: hash.status,
		profileId: hash.profileId,
		applierName: hash.applierName,
		ownerUid: hash.ownerUid || null,
		payload: json(hash.payload, {}),
		progress: json(hash.progress, {}),
		result: json(hash.result, null),
		error: hash.error || null,
		createdAt: hash.createdAt,
		startedAt: hash.startedAt || null,
		cancelRequestedAt: hash.cancelRequestedAt || null,
		cancelAcknowledgedAt: hash.cancelAcknowledgedAt || null,
		finishedAt: hash.finishedAt || null,
		updatedAt: hash.updatedAt || hash.createdAt,
	};
}

function taskHash(task) {
	return {
		id: task.id,
		requestId: task.requestId || '',
		type: task.type,
		lane: task.lane,
		status: task.status,
		profileId: task.profileId,
		applierName: task.applierName,
		ownerUid: task.ownerUid || '',
		payload: JSON.stringify(task.payload || {}),
		progress: JSON.stringify(task.progress || {}),
		result: task.result == null ? '' : JSON.stringify(task.result),
		error: task.error || '',
		createdAt: task.createdAt,
		startedAt: task.startedAt || '',
		cancelRequestedAt: task.cancelRequestedAt || '',
		cancelAcknowledgedAt: task.cancelAcknowledgedAt || '',
		finishedAt: task.finishedAt || '',
		updatedAt: task.updatedAt,
	};
}

function redisRequired() {
	if (!isRedisReady()) {
		const error = new Error('Background task service is unavailable because Redis is not ready');
		error.status = 503;
		error.code = 'BACKGROUND_TASK_REDIS_UNAVAILABLE';
		throw error;
	}
	return getRedis();
}

function firestoreTask(task) {
	const snapshot = publicTaskSnapshot(task);
	const { items: _items, targetIds: _targetIds, ...progressSummary } = snapshot.progress || {};
	const compactResult = task.result && typeof task.result === 'object'
		? Object.fromEntries(Object.entries(task.result).flatMap(([key, value]) => {
			if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) return [[key, value]];
			if (Array.isArray(value)) return [[`${key}Count`, value.length]];
			return [];
		}))
		: task.result || null;
	return {
		...snapshot,
		progress: progressSummary,
		result: compactResult,
		ownerUid: task.ownerUid || null,
		lane: task.lane,
	};
}

function enqueueFirestoreMirror(task) {
	const previous = mirrorChains.get(task.id) || Promise.resolve();
	const chain = previous
		.then(async () => {
			let effective = task;
			if (!TERMINAL_TASK_STATUSES.has(task.status)) {
				effective = await getBackgroundTask(task.id);
				if (!effective) return;
			}
			return firestoreMutationLimiter.run(() => backgroundTasksCollection.updateOne(
				{ _id: effective.id },
				{ $set: firestoreTask(effective) },
				{ upsert: true },
			));
		})
		.catch((error) => {
			console.warn('[background-task] Firestore mirror failed:', error?.message || error);
		});
	mirrorChains.set(task.id, chain);
	void chain.finally(() => {
		if (mirrorChains.get(task.id) === chain) mirrorChains.delete(task.id);
	});
}

function mirrorTask(task) {
	if (!backgroundTasksCollection || !task?.id) return;
	const immediate = TERMINAL_TASK_STATUSES.has(task.status);
	if (immediate) {
		const timer = mirrorTimers.get(task.id);
		if (timer) clearTimeout(timer);
		mirrorTimers.delete(task.id);
		mirrorLatest.delete(task.id);
		enqueueFirestoreMirror(task);
		return;
	}
	mirrorLatest.set(task.id, task);
	if (mirrorTimers.has(task.id)) return;
	const timer = setTimeout(() => {
		mirrorTimers.delete(task.id);
		const latest = mirrorLatest.get(task.id);
		mirrorLatest.delete(task.id);
		if (latest) {
			// Cancellation can win after a progress mutation was read but before this
			// timer was scheduled. Re-read Redis so a delayed non-terminal mirror can
			// never overwrite the terminal Firestore summary.
			void getBackgroundTask(latest.id)
				.then((current) => {
					if (current) enqueueFirestoreMirror(current);
				})
				.catch((error) => {
					console.warn('[background-task] Firestore mirror refresh failed:', error?.message || error);
				});
		}
	}, FIRESTORE_MIRROR_INTERVAL_MS);
	timer.unref?.();
	mirrorTimers.set(task.id, timer);
}

/** Wait until pending Firestore mirrors for the supplied tasks are durable. */
export async function flushBackgroundTaskMirrors(taskIds = []) {
	const ids = [...new Set(taskIds.map(clean).filter(Boolean))];
	for (const id of ids) {
		const timer = mirrorTimers.get(id);
		if (!timer) continue;
		clearTimeout(timer);
		mirrorTimers.delete(id);
		const latest = mirrorLatest.get(id);
		mirrorLatest.delete(id);
		if (latest) enqueueFirestoreMirror(latest);
	}
	await Promise.all(ids.map((id) => mirrorChains.get(id)).filter(Boolean));
}

async function appendEvent(redis, task, type, data = {}) {
	const stream = backgroundTaskKeys.profileEvents(task.profileId);
	const payload = JSON.stringify({
		taskId: task.id,
		type,
		at: nowIso(),
		...data,
	});
	const eventId = await redis.sendCommand([
		'XADD', stream,
		'MAXLEN', '~', String(BACKGROUND_EVENT_STREAM_MAX_LENGTH),
		'*',
		'type', type,
		'taskId', task.id,
		'data', payload,
	]);
	await redis.expire(stream, BACKGROUND_TASK_RETENTION_SECONDS).catch(() => undefined);
	return eventId;
}

async function activeTaskFor(redis, profileId, type) {
	const activeKey = backgroundTaskKeys.active(profileId, type);
	let taskId = await redis.get(activeKey);
	if (!taskId) return null;
	for (let attempt = 0; attempt < 20; attempt += 1) {
		const task = await getBackgroundTask(taskId);
		if (task) {
			if (ACTIVE_TASK_STATUSES.has(task.status)) return task;
			await deleteIfValue(redis, activeKey, taskId).catch(() => undefined);
			return null;
		}
		await reservationDelay(10);
		const current = await redis.get(activeKey);
		if (!current) return null;
		taskId = current;
	}
	const error = new Error(`${type} is still being registered; retry shortly`);
	error.status = 409;
	error.code = 'BACKGROUND_TASK_ACTIVE_RESERVATION_PENDING';
	throw error;
}

const reservationDelay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function resolveRequestReservation(redis, requestKey) {
	for (let attempt = 0; attempt < 20; attempt += 1) {
		const value = await redis.get(requestKey);
		if (!value) return null;
		const taskId = value.startsWith('pending:') ? value.slice('pending:'.length) : value;
		const task = await getBackgroundTask(taskId);
		if (task) return task;
		await reservationDelay(10);
	}
	const error = new Error('An identical background-task request is still being registered; retry shortly');
	error.status = 409;
	error.code = 'BACKGROUND_TASK_REQUEST_PENDING';
	throw error;
}

async function deleteIfValue(redis, key, expected) {
	return redis.eval(
		"if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0",
		{ keys: [key], arguments: [expected] },
	);
}

export async function getBackgroundWorkerHealth() {
	if (!isRedisReady()) return { ready: false, reason: 'redis_unavailable' };
	const value = await getRedis().get(backgroundTaskKeys.workerHeartbeat).catch(() => null);
	const heartbeatAt = Number(value || 0);
	const ageMs = heartbeatAt ? Date.now() - heartbeatAt : Infinity;
	return {
		ready: Number.isFinite(ageMs) && ageMs <= WORKER_HEARTBEAT_MAX_AGE_MS,
		heartbeatAt: heartbeatAt ? new Date(heartbeatAt).toISOString() : null,
		ageMs: Number.isFinite(ageMs) ? ageMs : null,
	};
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

export async function writeBackgroundWorkerHeartbeat() {
	const redis = redisRequired();
	await redis.set(backgroundTaskKeys.workerHeartbeat, String(Date.now()), { EX: 30 });
}

export async function createBackgroundTask({
	requestId,
	type,
	profileId,
	applierName,
	ownerUid,
	payload = {},
	progress = {},
}) {
	const redis = redisRequired();
	await requireBackgroundWorker();
	const normalizedProfileId = clean(profileId) || clean(applierName).toLocaleLowerCase('en-US');
	const normalizedRequestId = clean(requestId) || randomUUID();
	const lane = laneForTaskType(type);
	if (!lane) {
		const error = new Error(`Unsupported background task type: ${type}`);
		error.status = 400;
		throw error;
	}
	if (!normalizedProfileId) {
		const error = new Error('profileId or applierName is required');
		error.status = 400;
		throw error;
	}

	const requestKey = backgroundTaskKeys.request(normalizedProfileId, normalizedRequestId);
	const duplicateId = await redis.get(requestKey);
	if (duplicateId) {
		const duplicate = await resolveRequestReservation(redis, requestKey);
		if (duplicate) return { task: duplicate, created: false, duplicate: true };
	}

	if (SINGLETON_TASK_TYPES.has(type)) {
		const active = await activeTaskFor(redis, normalizedProfileId, type);
		if (active) {
			await redis.set(requestKey, active.id, { NX: true, EX: BACKGROUND_TASK_RETENTION_SECONDS });
			return { task: active, created: false, alreadyActive: true };
		}
	}

	const id = randomUUID();
	const pendingRequestValue = `pending:${id}`;
	let requestReserved = await redis.set(requestKey, pendingRequestValue, { NX: true, EX: 30 });
	if (!requestReserved) {
		const duplicate = await resolveRequestReservation(redis, requestKey);
		if (duplicate) return { task: duplicate, created: false, duplicate: true };
		requestReserved = await redis.set(requestKey, pendingRequestValue, { NX: true, EX: 30 });
		if (!requestReserved) {
			const error = new Error('An identical background task request already exists');
			error.status = 409;
			throw error;
		}
	}
	const createdAt = nowIso();
	const task = {
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
		createdAt,
		startedAt: null,
		cancelRequestedAt: null,
		cancelAcknowledgedAt: null,
		finishedAt: null,
		updatedAt: createdAt,
	};

	const activeKey = SINGLETON_TASK_TYPES.has(type)
		? backgroundTaskKeys.active(normalizedProfileId, type)
		: null;
	if (activeKey) {
		const reserved = await redis.set(activeKey, id, { NX: true, EX: BACKGROUND_TASK_RETENTION_SECONDS });
		if (!reserved) {
			const active = await activeTaskFor(redis, normalizedProfileId, type);
			if (active) {
				await redis.set(requestKey, active.id, { EX: BACKGROUND_TASK_RETENTION_SECONDS });
				return { task: active, created: false, alreadyActive: true };
			}
			const retry = await redis.set(activeKey, id, { NX: true, EX: BACKGROUND_TASK_RETENTION_SECONDS });
			if (!retry) {
				await deleteIfValue(redis, requestKey, pendingRequestValue).catch(() => undefined);
				const error = new Error(`${type} already has an active task`);
				error.status = 409;
				throw error;
			}
		}
	}

	try {
		const multi = redis.multi();
		multi.hSet(backgroundTaskKeys.task(id), taskHash(task));
		multi.expire(backgroundTaskKeys.task(id), BACKGROUND_TASK_RETENTION_SECONDS);
		multi.set(requestKey, id, { EX: BACKGROUND_TASK_RETENTION_SECONDS });
		multi.zAdd(backgroundTaskKeys.profileTasks(normalizedProfileId), {
			score: Date.now(),
			value: id,
		});
		multi.expire(backgroundTaskKeys.profileTasks(normalizedProfileId), BACKGROUND_TASK_RETENTION_SECONDS);
		await multi.exec();
		await redis.zRemRangeByScore(
			backgroundTaskKeys.profileTasks(normalizedProfileId),
			0,
			Date.now() - (BACKGROUND_TASK_RETENTION_SECONDS * 1_000),
		).catch(() => undefined);
		await appendEvent(redis, task, 'task-created', { task: publicTaskSnapshot(task) });
		await getBackgroundQueue(lane).add(type, { taskId: id }, { jobId: id });
		incrementCounter('athens_background_tasks_enqueued_total', { type, lane });
		mirrorTask(task);
		return { task, created: true };
	} catch (error) {
		if (activeKey) await deleteIfValue(redis, activeKey, id).catch(() => undefined);
		await deleteIfValue(redis, requestKey, id).catch(() => undefined);
		await deleteIfValue(redis, requestKey, pendingRequestValue).catch(() => undefined);
		await redis.del(backgroundTaskKeys.task(id)).catch(() => undefined);
		await redis.zRem(backgroundTaskKeys.profileTasks(normalizedProfileId), id).catch(() => undefined);
		const unavailable = error instanceof Error ? error : new Error(String(error));
		if (!Number.isInteger(unavailable.status)) unavailable.status = 503;
		unavailable.code ||= 'BACKGROUND_TASK_QUEUE_UNAVAILABLE';
		throw unavailable;
	}
}

export async function getBackgroundTask(taskId) {
	const redis = redisRequired();
	const hash = await redis.hGetAll(backgroundTaskKeys.task(taskId));
	return parseTaskHash(hash);
}

export async function listBackgroundTasks(profileId, { activeOnly = false, limit = 100 } = {}) {
	const redis = redisRequired();
	const ids = await redis.zRange(
		backgroundTaskKeys.profileTasks(profileId),
		0,
		Math.max(0, Math.min(500, limit) - 1),
		{ REV: true },
	);
	const tasks = (await Promise.all(ids.map((id) => getBackgroundTask(id)))).filter(Boolean);
	return activeOnly ? tasks.filter((task) => ACTIVE_TASK_STATUSES.has(task.status)) : tasks;
}

export async function findActiveBackgroundTask(profileId, type) {
	const redis = redisRequired();
	if (SINGLETON_TASK_TYPES.has(type)) return activeTaskFor(redis, profileId, type);
	const tasks = await listBackgroundTasks(profileId, { activeOnly: true, limit: 100 });
	return tasks.find((task) => task.type === type) || null;
}

export async function updateBackgroundTask(taskId, patch, {
	eventType = 'task-updated',
	eventData = {},
	includeTaskSnapshot = true,
} = {}) {
	const redis = redisRequired();
	const current = await getBackgroundTask(taskId);
	if (!current) throw new Error(`Background task ${taskId} not found`);
	const updatedAt = nowIso();
	const next = {
		...current,
		...patch,
		progress: patch.progress ? { ...current.progress, ...patch.progress } : current.progress,
		updatedAt,
	};
	const hashPatch = { updatedAt };
	for (const field of [
		'status', 'startedAt', 'cancelRequestedAt', 'cancelAcknowledgedAt', 'finishedAt', 'error',
	]) {
		if (Object.prototype.hasOwnProperty.call(patch, field)) hashPatch[field] = patch[field] || '';
	}
	if (Object.prototype.hasOwnProperty.call(patch, 'progress')) hashPatch.progress = JSON.stringify(next.progress || {});
	if (Object.prototype.hasOwnProperty.call(patch, 'result')) {
		hashPatch.result = patch.result == null ? '' : JSON.stringify(patch.result);
	}
	let applied = true;
	let effectiveTask = next;
	if (patch.status) {
		const pairs = Object.entries(hashPatch).flatMap(([field, value]) => [field, String(value ?? '')]);
		const guardedScript = `
			local current = redis.call('HGET', KEYS[1], 'status')
			local next = ARGV[1]
			if not current then return 0 end
			if current == 'cancelled' or current == 'completed' or current == 'completed_with_errors' or current == 'failed' then
				return 0
			end
			if next == 'cancelled' then
				if current ~= 'cancelling' or redis.call('EXISTS', KEYS[2]) ~= 1 then return 0 end
			elseif redis.call('EXISTS', KEYS[2]) == 1 then
				return 0
			elseif next == 'running' then
				if current ~= 'queued' then return 0 end
			elseif next == 'completed' or next == 'completed_with_errors' or next == 'failed' then
				if current ~= 'running' then return 0 end
			else
				return 0
			end
			redis.call('HSET', KEYS[1], unpack(ARGV, 2))
			return 1
		`;
		applied = Number(await redis.eval(guardedScript, {
			keys: [backgroundTaskKeys.task(taskId), backgroundTaskKeys.cancel(taskId)],
			arguments: [patch.status, ...pairs],
		})) === 1;
	} else {
		const { updatedAt: _candidate, ...fields } = hashPatch;
		const pairs = Object.entries(fields).flatMap(([field, value]) => [field, String(value ?? '')]);
		applied = Number(await redis.eval(`
			local current = redis.call('HGET', KEYS[1], 'status')
			if current ~= 'running' or redis.call('EXISTS', KEYS[2]) == 1 then return 0 end
			local current_updated_at = redis.call('HGET', KEYS[1], 'updatedAt')
			if current_updated_at and ARGV[1] <= current_updated_at then return 0 end
			redis.call('HSET', KEYS[1], 'updatedAt', ARGV[1])
			if #ARGV > 1 then redis.call('HSET', KEYS[1], unpack(ARGV, 2)) end
			return 1
		`, {
			keys: [backgroundTaskKeys.task(taskId), backgroundTaskKeys.cancel(taskId)],
			arguments: [updatedAt, ...pairs],
		})) === 1;
		if (!applied) return getBackgroundTask(taskId);
		effectiveTask = await getBackgroundTask(taskId) || next;
	}
	if (!applied) return getBackgroundTask(taskId);
	await redis.expire(backgroundTaskKeys.task(taskId), BACKGROUND_TASK_RETENTION_SECONDS);
	const { items: _eventItems, targetIds: _eventTargets, ...progressSummary } = effectiveTask.progress || {};
	await appendEvent(redis, effectiveTask, eventType, includeTaskSnapshot
		? { task: publicTaskSnapshot(effectiveTask), ...eventData }
		: {
			taskId: effectiveTask.id,
			status: effectiveTask.status,
			updatedAt: effectiveTask.updatedAt,
			progress: progressSummary,
			...eventData,
		});
	if (TERMINAL_TASK_STATUSES.has(effectiveTask.status)) {
		await releaseSingletonTask(effectiveTask);
	}
	mirrorTask(effectiveTask);
	return effectiveTask;
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
		startedAt: nowIso(),
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
		finishedAt: nowIso(),
	}, { eventType: 'task-completed' });
}

export async function failBackgroundTask(taskId, error) {
	if (await isBackgroundTaskCancellationRequested(taskId)) {
		return acknowledgeBackgroundTaskCancellation(taskId);
	}
	return updateBackgroundTask(taskId, {
		status: BACKGROUND_TASK_STATUS.FAILED,
		error: error instanceof Error ? error.message : String(error),
		finishedAt: nowIso(),
	}, { eventType: 'task-failed' });
}

export async function requestBackgroundTaskCancellation(taskId) {
	const redis = redisRequired();
	const task = await getBackgroundTask(taskId);
	if (!task) return null;
	if (TERMINAL_TASK_STATUSES.has(task.status)) return task;
	const at = nowIso();
	const data = JSON.stringify({ taskId, profileId: task.profileId, at });
	const script = `
		local current = redis.call('HGET', KEYS[1], 'status')
		if not current or current == 'cancelling' or current == 'cancelled' or current == 'completed' or current == 'completed_with_errors' or current == 'failed' then
			return 0
		end
		redis.call('HSET', KEYS[1], 'status', ARGV[1], 'cancelRequestedAt', ARGV[2], 'updatedAt', ARGV[2])
		redis.call('EXPIRE', KEYS[1], tonumber(ARGV[3]))
		redis.call('SET', KEYS[2], ARGV[2], 'EX', tonumber(ARGV[3]))
		redis.call('XADD', KEYS[3], 'MAXLEN', '~', tonumber(ARGV[4]), '*', 'type', 'task-cancel-requested', 'taskId', ARGV[5], 'data', ARGV[6])
		redis.call('EXPIRE', KEYS[3], tonumber(ARGV[3]))
		redis.call('PUBLISH', KEYS[4], ARGV[6])
		return 1
	`;
	const applied = Number(await redis.eval(script, {
		keys: [
			backgroundTaskKeys.task(taskId),
			backgroundTaskKeys.cancel(taskId),
			backgroundTaskKeys.profileEvents(task.profileId),
			backgroundTaskKeys.controlChannel,
		],
		arguments: [
			BACKGROUND_TASK_STATUS.CANCELLING,
			at,
			String(BACKGROUND_TASK_RETENTION_SECONDS),
			String(BACKGROUND_EVENT_STREAM_MAX_LENGTH),
			taskId,
			data,
		],
	})) === 1;
	if (!applied) return getBackgroundTask(taskId);
	incrementCounter('athens_background_task_cancel_requests_total', { type: task.type, lane: task.lane });
	const next = {
		...task,
		status: BACKGROUND_TASK_STATUS.CANCELLING,
		cancelRequestedAt: at,
		updatedAt: at,
	};
	mirrorTask(next);
	return next;
}

export async function acknowledgeBackgroundTaskCancellation(taskId, { progress = null } = {}) {
	const task = await getBackgroundTask(taskId);
	if (!task) return null;
	if (task.status === BACKGROUND_TASK_STATUS.CANCELLED) return task;
	const at = nowIso();
	return updateBackgroundTask(taskId, {
		status: BACKGROUND_TASK_STATUS.CANCELLED,
		...(progress ? { progress } : {}),
		cancelAcknowledgedAt: at,
		finishedAt: at,
	}, { eventType: 'task-cancelled' });
}

export async function isBackgroundTaskCancellationRequested(taskId) {
	const redis = redisRequired();
	return Boolean(await redis.exists(backgroundTaskKeys.cancel(taskId)));
}

export async function releaseSingletonTask(task) {
	if (!task || !SINGLETON_TASK_TYPES.has(task.type)) return;
	const redis = redisRequired();
	const key = backgroundTaskKeys.active(task.profileId, task.type);
	const current = await redis.get(key);
	if (current === task.id) await redis.del(key);
}

export async function publishBackgroundTaskItemEvent(taskId, eventType, data) {
	const redis = redisRequired();
	const task = await getBackgroundTask(taskId);
	if (!task || task.status !== BACKGROUND_TASK_STATUS.RUNNING) return null;
	if (await redis.exists(backgroundTaskKeys.cancel(taskId))) return null;
	return appendEvent(redis, task, eventType, data);
}

export const backgroundTaskStoreTest = {
	parseTaskHash,
	taskHash,
	firestoreTask,
};
