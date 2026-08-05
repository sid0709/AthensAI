import { AsyncLocalStorage } from 'node:async_hooks';
import { getBackgroundTask } from './taskStore.js';
import { BACKGROUND_TASK_STATUS } from './taskTypes.js';

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
	const task = await getBackgroundTask(taskId);
	if (!task || [
		BACKGROUND_TASK_STATUS.CANCELLING,
		BACKGROUND_TASK_STATUS.CANCELLED,
		BACKGROUND_TASK_STATUS.FAILED,
	].includes(task.status)) throw cancellationError(signal);
}
