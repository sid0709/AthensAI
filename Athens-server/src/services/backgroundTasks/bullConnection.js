import { Queue, QueueEvents } from 'bullmq';
import { backgroundTaskKeys } from './redisKeys.js';
import { TASK_LANES } from './taskTypes.js';

const queues = new Map();
const queueEvents = new Map();

export function bullConnectionOptions({ worker = false } = {}) {
	const raw = String(process.env.REDIS_URL || 'redis://127.0.0.1:6379').trim();
	const url = new URL(raw);
	const database = url.pathname && url.pathname !== '/'
		? Number.parseInt(url.pathname.slice(1), 10)
		: 0;
	return {
		host: url.hostname || '127.0.0.1',
		port: Number(url.port || 6379),
		...(url.username ? { username: decodeURIComponent(url.username) } : {}),
		...(url.password ? { password: decodeURIComponent(url.password) } : {}),
		...(Number.isFinite(database) && database > 0 ? { db: database } : {}),
		...(url.protocol === 'rediss:' ? { tls: {} } : {}),
		connectTimeout: Math.max(250, Number(process.env.REDIS_CONNECT_TIMEOUT_MS || 1_000)),
		maxRetriesPerRequest: worker ? null : 1,
	};
}

export function getBackgroundQueue(lane) {
	if (!Object.values(TASK_LANES).includes(lane)) throw new Error(`Unknown background-task lane: ${lane}`);
	let queue = queues.get(lane);
	if (!queue) {
		queue = new Queue(backgroundTaskKeys.queue(lane), {
			connection: bullConnectionOptions(),
			defaultJobOptions: {
				removeOnComplete: { age: 24 * 60 * 60, count: 5_000 },
				removeOnFail: { age: 7 * 24 * 60 * 60, count: 5_000 },
				// Provider and persistence retries happen inside idempotent processors.
				// BullMQ is responsible for stalled/crashed-job recovery, not replaying a
				// task that has already been marked terminal by the worker.
				attempts: 1,
			},
		});
		queues.set(lane, queue);
	}
	return queue;
}

export function getBackgroundQueueEvents(lane) {
	if (!Object.values(TASK_LANES).includes(lane)) throw new Error(`Unknown background-task lane: ${lane}`);
	let events = queueEvents.get(lane);
	if (!events) {
		events = new QueueEvents(backgroundTaskKeys.queue(lane), {
			connection: bullConnectionOptions({ worker: true }),
		});
		events.on('error', (error) => {
			console.error(`[background-task] ${lane} queue-events error:`, error?.message || error);
		});
		queueEvents.set(lane, events);
	}
	return events;
}

export async function closeBackgroundQueues() {
	await Promise.all([
		...[...queues.values()].map((queue) => queue.close()),
		...[...queueEvents.values()].map((events) => events.close()),
	]);
	queues.clear();
	queueEvents.clear();
}
