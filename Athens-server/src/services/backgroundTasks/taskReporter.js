import {
	publishBackgroundTaskItemEvent,
	updateBackgroundTask,
} from './taskStore.js';

/** Serialize task mutations emitted by concurrently running item handlers. */
export function createTaskReporter(taskId) {
	let chain = Promise.resolve();

	function enqueue(operation) {
		const next = chain.then(operation);
		chain = next.catch(() => undefined);
		return next;
	}

	return {
		progress(progress, eventData = {}) {
			const progressSnapshot = structuredClone(progress);
			const eventSnapshot = structuredClone(eventData);
			return enqueue(() => updateBackgroundTask(taskId, { progress: progressSnapshot }, {
				eventType: 'task-progress',
				eventData: eventSnapshot,
				includeTaskSnapshot: false,
			}));
		},
		item(eventType, data) {
			const snapshot = structuredClone(data);
			return enqueue(() => publishBackgroundTaskItemEvent(taskId, eventType, snapshot));
		},
		flush() {
			return chain;
		},
	};
}
