const PREFIX = 'athens:background:v1';

function segment(value) {
	return encodeURIComponent(String(value ?? '').trim());
}

export const backgroundTaskKeys = Object.freeze({
	task: (taskId) => `${PREFIX}:task:${segment(taskId)}`,
	cancel: (taskId) => `${PREFIX}:cancel:${segment(taskId)}`,
	request: (profileId, requestId) => `${PREFIX}:request:${segment(profileId)}:${segment(requestId)}`,
	active: (profileId, type) => `${PREFIX}:active:${segment(profileId)}:${segment(type)}`,
	profileTasks: (profileId) => `${PREFIX}:profile:${segment(profileId)}:tasks`,
	profileEvents: (profileId) => `${PREFIX}:profile:${segment(profileId)}:events`,
	controlChannel: `${PREFIX}:control`,
	workerHeartbeat: `${PREFIX}:worker:heartbeat`,
	// BullMQ reserves ':' for its own Redis keys.
	queue: (lane) => `athens-background-v1-${segment(lane)}`,
});

export const BACKGROUND_TASK_RETENTION_SECONDS = Math.max(
	60 * 60,
	Number.parseInt(String(process.env.BACKGROUND_TASK_RETENTION_SECONDS || ''), 10) || 7 * 24 * 60 * 60,
);

export const BACKGROUND_EVENT_STREAM_MAX_LENGTH = Math.max(
	100,
	Number.parseInt(String(process.env.BACKGROUND_EVENT_STREAM_MAX_LENGTH || ''), 10) || 2_000,
);
