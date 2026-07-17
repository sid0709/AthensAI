import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	createFairLimiter,
	createLimiter,
	createPdfRenderLimiter,
	createPriorityLimiter,
	createResumeGenFairLimiter,
	DEFAULT_PDF_RENDER_CONCURRENCY,
	DEFAULT_RESUME_GEN_GLOBAL_CONCURRENCY,
	DEFAULT_RESUME_GEN_PER_USER_CONCURRENCY,
	getPdfRenderConcurrency,
	getResumeGenGlobalConcurrency,
	getResumeGenPerUserConcurrency,
	LLM_PRIORITY,
	llmPriorityFromFeature,
	mapPool,
} from './concurrency.js';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('createLimiter caps concurrent work', async () => {
	const limiter = createLimiter({ concurrency: 2 });
	let peak = 0;
	let active = 0;

	await Promise.all(
		Array.from({ length: 6 }, () =>
			limiter.run(async () => {
				active++;
				peak = Math.max(peak, active);
				await delay(20);
				active--;
			}),
		),
	);

	assert.equal(peak, 2);
	assert.equal(limiter.active, 0);
	assert.equal(limiter.pending, 0);
});

test('createLimiter serves waiters in FIFO order', async () => {
	const limiter = createLimiter({ concurrency: 1 });
	const order = [];

	const releaseFirst = defer();
	const first = limiter.run(async () => {
		order.push('first-start');
		await releaseFirst.promise;
		order.push('first-end');
	});

	await delay(10);
	assert.equal(limiter.active, 1);

	const second = limiter.run(async () => {
		order.push('second');
	});
	const third = limiter.run(async () => {
		order.push('third');
	});

	await delay(10);
	assert.equal(limiter.pending, 2);

	releaseFirst.resolve();
	await Promise.all([first, second, third]);

	assert.deepEqual(order, ['first-start', 'first-end', 'second', 'third']);
});

test('createFairLimiter enforces global and per-key caps', async () => {
	const limiter = createFairLimiter({ globalConcurrency: 2, perKeyConcurrency: 1 });
	const releaseA = defer();
	const releaseB = defer();

	const taskA = limiter.run('alice', async () => {
		await releaseA.promise;
		return 'a';
	});
	const taskB = limiter.run('bob', async () => {
		await releaseB.promise;
		return 'b';
	});

	await delay(10);
	assert.equal(limiter.globalActive, 2);
	assert.equal(limiter.keyActive('alice'), 1);
	assert.equal(limiter.keyActive('bob'), 1);

	let aliceSecondStarted = false;
	const aliceSecond = limiter.run('alice', async () => {
		aliceSecondStarted = true;
	});

	await delay(10);
	assert.equal(aliceSecondStarted, false);
	assert.equal(limiter.pending, 1);

	releaseA.resolve();
	await taskA;
	await delay(10);
	assert.equal(aliceSecondStarted, true);

	releaseB.resolve();
	await Promise.all([taskB, aliceSecond]);
	assert.equal(limiter.globalActive, 0);
});

test('createFairLimiter skips ahead when head is per-key saturated', async () => {
	const limiter = createFairLimiter({ globalConcurrency: 2, perKeyConcurrency: 1 });
	const releaseA = defer();
	const releaseB = defer();
	const order = [];

	const holdA = limiter.run('alice', async () => {
		order.push('alice-1-start');
		await releaseA.promise;
		order.push('alice-1-end');
	});

	await delay(10);

	// Alice is at per-key max; alice-2 is blocked at head — bob must still start.
	let bobStarted = false;
	const waitAlice2 = limiter.run('alice', async () => {
		order.push('alice-2');
	});
	const waitBob = limiter.run('bob', async () => {
		bobStarted = true;
		order.push('bob-start');
		await releaseB.promise;
		order.push('bob-end');
	});

	await delay(20);
	assert.equal(bobStarted, true);
	assert.equal(limiter.globalActive, 2);
	assert.equal(limiter.keyActive('bob'), 1);

	releaseA.resolve();
	await holdA;
	await delay(10);
	assert.ok(order.includes('alice-2'));

	releaseB.resolve();
	await Promise.all([waitBob, waitAlice2]);

	assert.ok(order.indexOf('alice-1-end') < order.indexOf('alice-2'));
});

test('createFairLimiter preserves per-key FIFO under skip-ahead', async () => {
	const limiter = createFairLimiter({ globalConcurrency: 1, perKeyConcurrency: 1 });
	const order = [];

	const releaseA = defer();
	const holdA = limiter.run('alice', async () => {
		order.push('alice-1-start');
		await releaseA.promise;
		order.push('alice-1-end');
	});

	await delay(10);

	const waitBob = limiter.run('bob', async () => {
		order.push('bob');
	});
	const waitAlice2 = limiter.run('alice', async () => {
		order.push('alice-2');
	});

	await delay(10);
	assert.equal(limiter.pending, 2);

	releaseA.resolve();
	await Promise.all([holdA, waitBob, waitAlice2]);

	// With global=1, bob and alice-2 serialize after alice-1; bob was queued first.
	assert.deepEqual(order, ['alice-1-start', 'alice-1-end', 'bob', 'alice-2']);
});

test('env helpers use documented defaults and positive overrides', () => {
	const saved = {
		RESUME_GEN_GLOBAL_CONCURRENCY: process.env.RESUME_GEN_GLOBAL_CONCURRENCY,
		RESUME_GEN_PER_USER_CONCURRENCY: process.env.RESUME_GEN_PER_USER_CONCURRENCY,
		PDF_RENDER_CONCURRENCY: process.env.PDF_RENDER_CONCURRENCY,
	};

	delete process.env.RESUME_GEN_GLOBAL_CONCURRENCY;
	delete process.env.RESUME_GEN_PER_USER_CONCURRENCY;
	delete process.env.PDF_RENDER_CONCURRENCY;

	try {
		assert.equal(getResumeGenGlobalConcurrency(), DEFAULT_RESUME_GEN_GLOBAL_CONCURRENCY);
		assert.equal(getResumeGenPerUserConcurrency(), DEFAULT_RESUME_GEN_PER_USER_CONCURRENCY);
		assert.equal(getPdfRenderConcurrency(), DEFAULT_PDF_RENDER_CONCURRENCY);

		process.env.RESUME_GEN_GLOBAL_CONCURRENCY = '6';
		process.env.RESUME_GEN_PER_USER_CONCURRENCY = '3';
		process.env.PDF_RENDER_CONCURRENCY = '1';

		assert.equal(getResumeGenGlobalConcurrency(), 6);
		assert.equal(getResumeGenPerUserConcurrency(), 3);
		assert.equal(getPdfRenderConcurrency(), 1);

		process.env.RESUME_GEN_GLOBAL_CONCURRENCY = '0';
		process.env.RESUME_GEN_PER_USER_CONCURRENCY = '-2';
		process.env.PDF_RENDER_CONCURRENCY = 'not-a-number';

		assert.equal(getResumeGenGlobalConcurrency(), DEFAULT_RESUME_GEN_GLOBAL_CONCURRENCY);
		assert.equal(getResumeGenPerUserConcurrency(), DEFAULT_RESUME_GEN_PER_USER_CONCURRENCY);
		assert.equal(getPdfRenderConcurrency(), DEFAULT_PDF_RENDER_CONCURRENCY);
	} finally {
		for (const [key, value] of Object.entries(saved)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
});

test('factory helpers build limiters from env', () => {
	const saved = {
		RESUME_GEN_GLOBAL_CONCURRENCY: process.env.RESUME_GEN_GLOBAL_CONCURRENCY,
		RESUME_GEN_PER_USER_CONCURRENCY: process.env.RESUME_GEN_PER_USER_CONCURRENCY,
		PDF_RENDER_CONCURRENCY: process.env.PDF_RENDER_CONCURRENCY,
	};

	process.env.RESUME_GEN_GLOBAL_CONCURRENCY = '5';
	process.env.RESUME_GEN_PER_USER_CONCURRENCY = '2';
	process.env.PDF_RENDER_CONCURRENCY = '3';

	try {
		const resumeLimiter = createResumeGenFairLimiter();
		const pdfLimiter = createPdfRenderLimiter();

		assert.equal(typeof resumeLimiter.run, 'function');
		assert.equal(typeof pdfLimiter.run, 'function');
		assert.equal(resumeLimiter.globalActive, 0);
		assert.equal(pdfLimiter.active, 0);
	} finally {
		for (const [key, value] of Object.entries(saved)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
});

test('createFairLimiter onQueued fires only when waiting', async () => {
	const limiter = createFairLimiter({ globalConcurrency: 1, perKeyConcurrency: 1 });
	let queued = 0;

	const first = limiter.run('solo', async () => {
		await delay(40);
	});

	const second = limiter.run(
		'solo',
		async () => {},
		{
			onQueued: async () => {
				queued += 1;
			},
		},
	);

	await Promise.all([first, second]);
	assert.equal(queued, 1);
});

test('mapPool preserves order and caps concurrency', async () => {
	let peak = 0;
	let active = 0;
	const results = await mapPool([1, 2, 3, 4, 5, 6], 2, async (n) => {
		active++;
		peak = Math.max(peak, active);
		await delay(15);
		active--;
		return n * 10;
	});
	assert.deepEqual(results, [10, 20, 30, 40, 50, 60]);
	assert.equal(peak, 2);
});

test('createPriorityLimiter serves higher priority first', async () => {
	const pool = createPriorityLimiter({ concurrency: 1 });
	const order = [];
	const releaseFirst = defer();

	const lowHold = pool.run(LLM_PRIORITY.skill, async () => {
		order.push('skill-start');
		await releaseFirst.promise;
		order.push('skill-end');
	});

	await delay(10);

	const agentJob = pool.run(LLM_PRIORITY.agent, async () => {
		order.push('agent');
	});
	const mailJob = pool.run(LLM_PRIORITY.mail, async () => {
		order.push('mail');
	});

	await delay(10);
	assert.equal(pool.pending, 2);

	releaseFirst.resolve();
	await Promise.all([lowHold, agentJob, mailJob]);
	assert.deepEqual(order, ['skill-start', 'skill-end', 'agent', 'mail']);
});

test('llmPriorityFromFeature maps feature strings', () => {
	assert.equal(llmPriorityFromFeature('agent-otp'), 'agent');
	assert.equal(llmPriorityFromFeature('resume-generate:summary'), 'resume');
	assert.equal(llmPriorityFromFeature('mail-ai-label'), 'mail');
	assert.equal(llmPriorityFromFeature('job-skill-extract'), 'skill');
	assert.equal(llmPriorityFromFeature('unknown-thing'), 'other');
});

function defer() {
	let resolve;
	const promise = new Promise((res) => {
		resolve = res;
	});
	return { promise, resolve };
}
