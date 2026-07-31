import test from 'node:test';
import assert from 'node:assert/strict';
import {
	backgroundTaskPayloadTest,
	normalizeBackgroundTaskPayload,
} from './taskPayload.js';
import { backgroundTaskStoreTest } from './taskStore.js';
import { bullConnectionOptions } from './bullConnection.js';
import {
	currentBackgroundTaskId,
	runWithBackgroundTaskContext,
	runWithoutBackgroundTaskContext,
} from './taskContext.js';
import {
	BACKGROUND_TASK_STATUS,
	BACKGROUND_TASK_TYPES,
	SINGLETON_TASK_TYPES,
	TASK_LANES,
	laneForTaskType,
	publicTaskSnapshot,
} from './taskTypes.js';

test('queue payload normalization retains identifiers/options but drops sensitive content', () => {
	const payload = normalizeBackgroundTaskPayload(BACKGROUND_TASK_TYPES.RESUME_GENERATION, {
		jobIds: ['job-1', 'job-1', 'job-2'],
		forceRegenerate: true,
		deferPdf: true,
		apiKey: 'secret',
		prompt: 'private prompt',
		jobDescription: 'private description',
		resume: 'private resume',
	});
	assert.deepEqual(payload, {
		jobIds: ['job-1', 'job-2'],
		forceRegenerate: true,
		deferPdf: true,
	});
});

test('stored resume inputs are referenced by record id only', () => {
	const payload = normalizeBackgroundTaskPayload(BACKGROUND_TASK_TYPES.RESUME_GENERATION, {
		requestRecordIds: ['input-a'],
		steps: [{ prompt: 'must not enter Redis' }],
	});
	assert.deepEqual(payload, {
		requestRecordIds: ['input-a'],
		forceRegenerate: false,
		deferPdf: true,
	});
});

test('resume task origin is a bounded routing hint, not arbitrary Redis data', () => {
	assert.equal(normalizeBackgroundTaskPayload(BACKGROUND_TASK_TYPES.RESUME_GENERATION, {
		jobIds: ['job-1'],
		origin: 'job_search',
	}).origin, 'job_search');
	assert.equal('origin' in normalizeBackgroundTaskPayload(BACKGROUND_TASK_TYPES.RESUME_GENERATION, {
		jobIds: ['job-1'],
		origin: 'untrusted-feature',
	}), false);
});

test('identity refresh payload keeps only its boolean option', () => {
	assert.deepEqual(normalizeBackgroundTaskPayload(BACKGROUND_TASK_TYPES.RESUME_IDENTITY_REFRESH, {
		forceAll: true,
		resume: 'private content',
		apiKey: 'secret',
	}), { forceAll: true });
});

test('mail AI labeling preserves the existing 50-message batch ceiling', () => {
	const fiftyIds = Array.from({ length: 50 }, (_, index) => `message-${index + 1}`);
	assert.equal(normalizeBackgroundTaskPayload(BACKGROUND_TASK_TYPES.MAIL_AI_LABEL, {
		messageIds: fiftyIds,
	}).messageIds.length, 50);
	assert.throws(() => normalizeBackgroundTaskPayload(BACKGROUND_TASK_TYPES.MAIL_AI_LABEL, {
		messageIds: [...fiftyIds, 'message-51'],
	}), /Maximum 50/);
});

test('oversized task inputs fail instead of silently dropping record ids', () => {
	const recordIds = Array.from(
		{ length: backgroundTaskPayloadTest.MAX_TASK_ITEMS + 1 },
		(_, index) => `record-${index + 1}`,
	);
	assert.throws(() => normalizeBackgroundTaskPayload(BACKGROUND_TASK_TYPES.JOB_REMOVAL, {
		recordIds,
	}), /Maximum .* recordIds/);
});

test('every public task type maps to an isolated worker lane', () => {
	for (const type of Object.values(BACKGROUND_TASK_TYPES)) {
		assert.ok(Object.values(TASK_LANES).includes(laneForTaskType(type)), type);
	}
	assert.equal(laneForTaskType(BACKGROUND_TASK_TYPES.JOB_REMOVAL), TASK_LANES.IO);
	assert.equal(laneForTaskType(BACKGROUND_TASK_TYPES.RESUME_GENERATION), TASK_LANES.AI);
	assert.ok(SINGLETON_TASK_TYPES.has(BACKGROUND_TASK_TYPES.TITLE_REVIEW));
	assert.ok(SINGLETON_TASK_TYPES.has(BACKGROUND_TASK_TYPES.SKILL_EXTRACTION));
});

test('public snapshots never expose internal payloads or ownership controls', () => {
	const snapshot = publicTaskSnapshot({
		id: 'task-1',
		requestId: 'request-1',
		type: BACKGROUND_TASK_TYPES.RESUME_GENERATION,
		status: BACKGROUND_TASK_STATUS.QUEUED,
		profileId: 'profile-1',
		applierName: 'Oliver',
		ownerUid: 'private-uid',
		payload: { requestRecordIds: ['private-input-id'] },
		progress: { completed: 0 },
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
	});
	assert.equal('payload' in snapshot, false);
	assert.equal('ownerUid' in snapshot, false);
	assert.equal(snapshot.status, 'queued');
});

test('Redis task hash serialization round-trips structured state', () => {
	const task = {
		id: 'task-1',
		requestId: 'request-1',
		type: BACKGROUND_TASK_TYPES.TITLE_REVIEW,
		lane: TASK_LANES.AI,
		status: BACKGROUND_TASK_STATUS.RUNNING,
		profileId: 'profile-1',
		applierName: 'Oliver',
		ownerUid: 'uid-1',
		payload: { limit: 100 },
		progress: { total: 100, completed: 10 },
		result: null,
		error: null,
		createdAt: '2026-01-01T00:00:00.000Z',
		startedAt: '2026-01-01T00:00:01.000Z',
		cancelRequestedAt: null,
		cancelAcknowledgedAt: null,
		finishedAt: null,
		updatedAt: '2026-01-01T00:00:02.000Z',
	};
	const parsed = backgroundTaskStoreTest.parseTaskHash(backgroundTaskStoreTest.taskHash(task));
	assert.deepEqual(parsed, task);
});

test('Firestore mirror stores a compact summary instead of per-item payloads', () => {
	const summary = backgroundTaskStoreTest.firestoreTask({
		id: 'task-2',
		requestId: 'request-2',
		type: BACKGROUND_TASK_TYPES.RESUME_GENERATION,
		lane: TASK_LANES.AI,
		status: BACKGROUND_TASK_STATUS.COMPLETED,
		profileId: 'profile-1',
		applierName: 'Oliver',
		ownerUid: 'uid-1',
		progress: {
			total: 100,
			completed: 100,
			targetIds: ['job-1'],
			items: { 'job-1': { status: 'completed', resumeText: 'private' } },
		},
		result: { completedJobIds: ['job-1'], provider: 'openai' },
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:01:00.000Z',
	});
	assert.equal('items' in summary.progress, false);
	assert.equal('targetIds' in summary.progress, false);
	assert.equal(summary.result.completedJobIdsCount, 1);
	assert.equal(summary.result.provider, 'openai');
});

test('HTTP queue producers fail fast while workers retain stalled-job recovery connections', () => {
	assert.equal(bullConnectionOptions().maxRetriesPerRequest, 1);
	assert.equal(bullConnectionOptions({ worker: true }).maxRetriesPerRequest, null);
});

test('consistency cleanup can leave and then restore a task cancellation context', async () => {
	await runWithBackgroundTaskContext('task-1', async () => {
		assert.equal(currentBackgroundTaskId(), 'task-1');
		await runWithoutBackgroundTaskContext(async () => {
			assert.equal(currentBackgroundTaskId(), null);
		});
		assert.equal(currentBackgroundTaskId(), 'task-1');
	});
});
