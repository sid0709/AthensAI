import { AsyncLocalStorage } from 'node:async_hooks';
import { getRedis, isRedisReady } from '../../db/redis.js';
import { backgroundTaskKeys } from './redisKeys.js';

const taskContext = new AsyncLocalStorage();

export function runWithBackgroundTaskContext(taskId, operation) {
	return taskContext.run({ taskId: String(taskId || '') }, operation);
}

/** Finish consistency cleanup for writes that committed before cancellation. */
export function runWithoutBackgroundTaskContext(operation) {
	return taskContext.run(null, operation);
}

export function currentBackgroundTaskId() {
	return taskContext.getStore()?.taskId || null;
}

function cancellationError(signal) {
	return signal?.reason instanceof Error
		? signal.reason
		: Object.assign(new Error('Background task cancelled'), { name: 'AbortError' });
}

/** Atomic durable fence used immediately before provider and mutation starts. */
export async function assertBackgroundTaskActive(signal) {
	if (signal?.aborted) throw cancellationError(signal);
	const taskId = currentBackgroundTaskId();
	if (!taskId) return;
	if (!isRedisReady()) {
		const error = new Error('Redis unavailable while checking background-task cancellation');
		error.status = 503;
		throw error;
	}
	const allowed = Number(await getRedis().eval(
		"if redis.call('EXISTS', KEYS[1]) == 1 then return 0 else return 1 end",
		{ keys: [backgroundTaskKeys.cancel(taskId)], arguments: [] },
	));
	if (!allowed) throw cancellationError(signal);
}
