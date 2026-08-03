import { duplicateRedisClient, isRedisConnectionError, isRedisReady } from '../db/redis.js';
import { backgroundTaskKeys } from '../services/backgroundTasks/redisKeys.js';
import { normalizeBackgroundTaskPayload } from '../services/backgroundTasks/taskPayload.js';
import {
	createBackgroundTask,
	getBackgroundTask,
	listBackgroundTasks,
	requestBackgroundTaskCancellation,
} from '../services/backgroundTasks/taskStore.js';
import {
	BACKGROUND_TASK_TYPES,
	isBackgroundTaskType,
	publicTaskSnapshot,
} from '../services/backgroundTasks/taskTypes.js';
import { accountInfoCollection } from '../db/dataStore.js';
import { isBetaTier } from '../lib/betaTier.js';

function clean(value) {
	return String(value ?? '').trim();
}

function isAdmin(req) {
	return req.auth?.admin === true || String(req.auth?.role || '').toLowerCase() === 'admin';
}

function requestIdentity(req) {
	const authenticatedName = clean(req.authProfile?.profileName || req.authProfile?.applierName);
	const authenticatedProfileId = clean(req.authProfile?.profileId);
	const applierName = authenticatedName || clean(req.body?.applierName || req.query?.applierName);
	const profileId = authenticatedProfileId || clean(req.body?.profileId || req.query?.profileId)
		|| applierName.toLocaleLowerCase('en-US');
	return { applierName, profileId, ownerUid: clean(req.auth?.uid) || null };
}

function canAccessTask(req, task) {
	if (!task) return false;
	if (isAdmin(req)) return true;
	const uid = clean(req.auth?.uid);
	if (uid && task.ownerUid) return uid === task.ownerUid;
	// Authentication-disabled local development has no token identity to compare.
	// Production requests never reach this branch because the global middleware
	// rejects missing tokens before routing.
	if (!req.auth && !task.ownerUid) return true;
	const { profileId, applierName } = requestIdentity(req);
	return profileId === task.profileId
		|| (applierName && applierName.toLocaleLowerCase('en-US') === task.applierName.toLocaleLowerCase('en-US'));
}

function errorResponse(res, error) {
	const redisUnavailable = isRedisConnectionError(error);
	const status = Number.isInteger(error?.status) ? error.status : redisUnavailable ? 503 : 500;
	return res.status(status).json({
		success: false,
		error: redisUnavailable ? 'Background task service is temporarily unavailable' : error?.message || 'Background task request failed',
		code: error?.code || (redisUnavailable ? 'BACKGROUND_TASK_REDIS_UNAVAILABLE' : undefined),
		...(error?.betaRequired ? { betaRequired: true } : {}),
		...(error?.health ? { health: error.health } : {}),
	});
}

async function authorizeTaskType(req, type, applierName) {
	const mayRunSystemTask = isAdmin(req) || (!req.auth && process.env.NODE_ENV !== 'production');
	if ([
		BACKGROUND_TASK_TYPES.SKILL_ENRICHMENT,
		BACKGROUND_TASK_TYPES.JOB_EMBEDDING,
	].includes(type) && !mayRunSystemTask) {
		throw Object.assign(new Error('Administrator access is required for this background task'), { status: 403 });
	}
	if (![
		BACKGROUND_TASK_TYPES.TITLE_REVIEW,
		BACKGROUND_TASK_TYPES.MAIL_AI_LABEL,
		BACKGROUND_TASK_TYPES.RESUME_IDENTITY_REFRESH,
	].includes(type)) return;
	if (!accountInfoCollection) throw Object.assign(new Error('Database not ready'), { status: 503 });
	let account = await accountInfoCollection.findOne(
		{ name: applierName },
		{ projection: { name: 1, tier: 1 } },
	);
	if (!account) {
		const escaped = applierName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		account = await accountInfoCollection.findOne(
			{ name: { $regex: new RegExp(`^${escaped}$`, 'i') } },
			{ projection: { name: 1, tier: 1 } },
		);
	}
	if (!account) throw Object.assign(new Error(`No account named "${applierName}"`), { status: 404 });
	if (!isBetaTier(account.tier)) {
		throw Object.assign(new Error('Beta workspace required.'), { status: 403, betaRequired: true });
	}
}

export async function createTask(req, res) {
	try {
		const type = clean(req.body?.type);
		if (!isBackgroundTaskType(type)) {
			return res.status(400).json({ success: false, error: `Unsupported background task type: ${type || '(missing)'}` });
		}
		const identity = requestIdentity(req);
		if (!identity.profileId || !identity.applierName) {
			return res.status(400).json({ success: false, error: 'profileId and applierName are required' });
		}
		await authorizeTaskType(req, type, identity.applierName);
		const payload = normalizeBackgroundTaskPayload(type, req.body?.payload);
		const targetIds = payload.jobIds
			|| payload.recordIds
			|| payload.resumeIds
			|| payload.messageIds
			|| payload.requestRecordIds
			|| [];
		const operation = type === 'resume_generation' && payload.origin
			? `${payload.origin}_resume_generation`
			: null;
		const result = await createBackgroundTask({
			requestId: req.body?.requestId,
			type,
			...identity,
			payload,
			progress: {
				total: targetIds.length || null,
				targetIds,
				...(operation ? { operation } : {}),
			},
		});
		return res.status(result.created ? 202 : 200).json({
			success: true,
			created: result.created,
			duplicate: result.duplicate === true,
			alreadyActive: result.alreadyActive === true,
			task: publicTaskSnapshot(result.task),
		});
	} catch (error) {
		console.error('POST /api/background-tasks error', error);
		return errorResponse(res, error);
	}
}

export async function listTasks(req, res) {
	try {
		const { profileId } = requestIdentity(req);
		if (!profileId) return res.status(400).json({ success: false, error: 'profileId is required' });
		const tasks = await listBackgroundTasks(profileId, {
			activeOnly: String(req.query?.active || '').toLowerCase() === 'true',
			limit: Number(req.query?.limit || 100),
		});
		return res.json({ success: true, tasks: tasks.map(publicTaskSnapshot) });
	} catch (error) {
		return errorResponse(res, error);
	}
}

export async function getTask(req, res) {
	try {
		const task = await getBackgroundTask(req.params.taskId);
		if (!task) return res.status(404).json({ success: false, error: 'Background task not found' });
		if (!canAccessTask(req, task)) return res.status(403).json({ success: false, error: 'Background task access denied' });
		return res.json({ success: true, task: publicTaskSnapshot(task) });
	} catch (error) {
		return errorResponse(res, error);
	}
}

export async function cancelTask(req, res) {
	try {
		const task = await getBackgroundTask(req.params.taskId);
		if (!task) return res.status(404).json({ success: false, error: 'Background task not found' });
		if (!canAccessTask(req, task)) return res.status(403).json({ success: false, error: 'Background task access denied' });
		const next = await requestBackgroundTaskCancellation(task.id);
		return res.status(202).json({ success: true, accepted: true, task: publicTaskSnapshot(next) });
	} catch (error) {
		return errorResponse(res, error);
	}
}

function writeSse(res, { id, event, data }) {
	if (res.destroyed || res.writableEnded) return;
	if (id) res.write(`id: ${id}\n`);
	res.write(`event: ${event}\n`);
	res.write(`data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`);
}

export async function streamTaskEvents(req, res) {
	if (!isRedisReady()) return res.status(503).json({ success: false, error: 'Background task events are unavailable' });
	const { profileId } = requestIdentity(req);
	if (!profileId) return res.status(400).json({ success: false, error: 'profileId is required' });

	res.writeHead(200, {
		'Content-Type': 'text/event-stream',
		'Cache-Control': 'no-cache, no-transform',
		Connection: 'keep-alive',
		'X-Accel-Buffering': 'no',
	});
	res.flushHeaders?.();

	const reader = duplicateRedisClient('background-task event stream');
	let closed = false;
	const close = () => {
		if (closed) return;
		closed = true;
		try {
			const pending = reader.disconnect();
			if (pending && typeof pending.catch === 'function') void pending.catch(() => undefined);
		} catch {
			// The duplicate may have closed before connect completed.
		}
	};
	req.on('close', close);
	req.on('aborted', close);

	try {
		await reader.connect();
		const stream = backgroundTaskKeys.profileEvents(profileId);
		let cursor = clean(req.headers['last-event-id'] || req.query?.lastEventId);
		if (!cursor) {
			// Capture the stream tail before taking the snapshot. Any task change
			// after this point is then replayed, closing the snapshot/XREAD race that
			// Redis' special '$' cursor would otherwise introduce.
			const tail = await reader.xRevRange(stream, '+', '-', { COUNT: 1 });
			cursor = tail?.[0]?.id || '0-0';
		}
		// Include recent terminal tasks so a tab that slept through a broadcast can
		// reconcile a formerly-active task immediately on reconnect.
		const tasks = await listBackgroundTasks(profileId, { activeOnly: false, limit: 100 });
		writeSse(res, {
			event: 'snapshot',
			data: { tasks: tasks.map(publicTaskSnapshot), at: new Date().toISOString() },
		});
		while (!closed) {
			const rows = await reader.xRead({ key: stream, id: cursor }, { BLOCK: 15_000, COUNT: 100 });
			if (closed) break;
			if (!rows?.length) {
				writeSse(res, { event: 'heartbeat', data: { at: new Date().toISOString() } });
				continue;
			}
			for (const row of rows) {
				for (const message of row.messages || []) {
					cursor = message.id;
					writeSse(res, {
						id: message.id,
						event: message.message?.type || 'task-event',
						data: message.message?.data || '{}',
					});
				}
			}
		}
	} catch (error) {
		if (!closed) {
			console.warn('[background-task] event stream failed:', error?.message || error);
			writeSse(res, { event: 'stream-error', data: { error: 'Task event stream interrupted' } });
		}
	} finally {
		close();
		if (!res.writableEnded) res.end();
	}
}

export const backgroundTaskControllerTest = { requestIdentity, canAccessTask, authorizeTaskType };
