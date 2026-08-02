import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	mergeResumeGenerationSteps,
	persistResumeSectionBeforeEmit,
} from './resumeGenerationProgress.js';

test('resume generation progress initializes and updates a complete checklist', () => {
	let steps = mergeResumeGenerationSteps([], {
		phase: 'pipeline-ready',
		steps: [
			{ index: 1, name: 'Experience fine-tune', purpose: 'experience', kind: 'fine-tune' },
			{ index: 2, name: 'Experience final', purpose: 'experience', kind: 'final' },
		],
	});
	assert.deepEqual(steps.map(({ index, status }) => [index, status]), [[1, 'pending'], [2, 'pending']]);

	steps = mergeResumeGenerationSteps(steps, { phase: 'step-start', index: 1 });
	steps = mergeResumeGenerationSteps(steps, {
		phase: 'step-done',
		index: 1,
		usage: { totalTokens: 42 },
	});
	assert.equal(steps[0].status, 'done');
	assert.deepEqual(steps[0].usage, { totalTokens: 42 });
	assert.equal(steps[1].status, 'pending');
});

test('a late start event cannot regress a completed checklist item', () => {
	let steps = mergeResumeGenerationSteps([], {
		phase: 'step-done',
		index: 3,
		name: 'Summary final',
		purpose: 'summary',
		kind: 'final',
	});
	steps = mergeResumeGenerationSteps(steps, { phase: 'step-start', index: 3 });
	assert.equal(steps[0].status, 'done');
	assert.equal(steps[0].name, 'Summary final');
});

test('a final section is persisted before its completion event is emitted', async () => {
	const order = [];
	await persistResumeSectionBeforeEmit(
		async () => { order.push('persisted'); },
		() => { order.push('emitted'); },
	);
	assert.deepEqual(order, ['persisted', 'emitted']);

	await assert.rejects(() => persistResumeSectionBeforeEmit(
		async () => { throw new Error('write failed'); },
		() => { order.push('must-not-emit'); },
	));
	assert.equal(order.includes('must-not-emit'), false);
});
