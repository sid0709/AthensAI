import assert from 'node:assert/strict';
import test from 'node:test';

import { serviceRestartDelay, startSupervisedService } from './dev-runtime.mjs';

test('service restart backoff is bounded', () => {
	assert.deepEqual(
		[0, 1, 2, 3, 4, 5, 20].map(serviceRestartDelay),
		[1_000, 2_000, 4_000, 8_000, 10_000, 10_000, 10_000],
	);
});

test('a failed service is restarted without stopping healthy siblings', () => {
	const exits = [];
	const lines = [];
	const scheduled = [];
	const started = [];
	const children = [];
	const start = (service, _onLine, onExit) => {
		started.push(service.name);
		const child = { killed: false, kill() { this.killed = true; } };
		children.push(child);
		exits.push(onExit);
		return child;
	};
	const supervisor = startSupervisedService(
		{ name: 'background-worker' },
		(entry) => lines.push(entry.line),
		() => undefined,
		{
			start,
			now: () => 1_000,
			schedule: (callback, delay) => {
				scheduled.push({ callback, delay });
				return scheduled.length;
			},
			cancelSchedule: () => undefined,
		},
	);

	exits[0]('background-worker', 1);
	assert.equal(supervisor.killed, false);
	assert.equal(scheduled[0].delay, 1_000);
	assert.match(lines.at(-1), /restarting in 1000ms/);
	scheduled[0].callback();
	assert.deepEqual(started, ['background-worker', 'background-worker']);

	supervisor.kill();
	assert.equal(children[1].killed, true);
});
