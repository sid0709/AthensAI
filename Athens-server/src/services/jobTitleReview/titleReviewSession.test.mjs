import test from 'node:test';
import assert from 'node:assert/strict';

import { finalizeTitleReviewSession } from './titleReviewSession.js';

function runningSession() {
	return {
		running: true,
		status: 'running',
		phase: 'processing',
		remaining: 123,
		finishedAt: null,
	};
}

test('marks a session complete before an unresolved cache rebuild', () => {
	const session = runningSession();
	let scheduled = 0;
	const never = new Promise(() => {});
	const startedAt = performance.now();
	const result = finalizeTitleReviewSession(session, {
		cancelled: false,
		now: () => '2026-07-30T12:00:00.000Z',
		scheduleRebuild: (options) => {
			scheduled += 1;
			assert.deepEqual(options, { delayMs: 0 });
			return never;
		},
	});

	assert.equal(result, session);
	assert.equal(session.running, false);
	assert.equal(session.status, 'completed');
	assert.equal(session.phase, null);
	assert.equal(session.remaining, 0);
	assert.equal(session.finishedAt, '2026-07-30T12:00:00.000Z');
	assert.equal(scheduled, 1);
	assert.ok(performance.now() - startedAt < 50);
});

test('preserves remaining work when cancellation finalizes the session', () => {
	const session = runningSession();
	finalizeTitleReviewSession(session, {
		cancelled: true,
		scheduleRebuild: () => undefined,
	});
	assert.equal(session.status, 'cancelled');
	assert.equal(session.remaining, 123);
	assert.ok(session.finishedAt);
});
