import assert from 'node:assert/strict';
import test from 'node:test';
import { __mailAiLabelInternals } from './aiLabelService.js';

const {
	chunkMessages,
	optimisticFlagPatch,
	parseJsonLoose,
	reasoningEffortForMail,
	resolveCanonicalLabel,
	resolveSnippetOutcomes,
} = __mailAiLabelInternals;

function message(id, bodySize = 100) {
	return { id, from: 'sender@example.com', subject: `Subject ${id}`, bodyText: 'x'.repeat(bodySize) };
}

test('AI label batching caps each request and preserves order', () => {
	const input = Array.from({ length: 19 }, (_, index) => message(String(index + 1)));
	const chunks = chunkMessages(input);
	assert.deepEqual(chunks.map((chunk) => chunk.length), [8, 8, 3]);
	assert.deepEqual(chunks.flat().map((item) => item.id), input.map((item) => item.id));
});

test('AI label batching also caps prompt size', () => {
	const chunks = chunkMessages([message('1', 20_000), message('2', 20_000), message('3', 100)]);
	assert.deepEqual(chunks.map((chunk) => chunk.map((item) => item.id)), [['1'], ['2', '3']]);
});

test('loose JSON parsing handles fenced batch responses', () => {
	assert.deepEqual(parseJsonLoose('```json\n{"results":[{"id":"7","label":null}]}\n```'), {
		results: [{ id: '7', label: null }],
	});
});

test('canonical labels accept case-only variation and reject hallucinations', () => {
	assert.equal(resolveCanonicalLabel('job search', ['Job Search', 'Receipts']), 'Job Search');
	assert.equal(resolveCanonicalLabel('Unknown', ['Job Search', 'Receipts']), null);
});

test('snippet classification accepts decisive actions and falls back on malformed rows', () => {
	const outcomes = resolveSnippetOutcomes(JSON.stringify({
		results: [
			{ id: '1', action: 'label', label: 'notify/job' },
			{ id: '2', action: 'no_match', label: null },
			{ id: '3', action: 'label', label: 'hallucinated' },
		],
	}), [{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }], ['Notify/Job']);
	assert.deepEqual(outcomes, [
		{ id: '1', action: 'label', label: 'Notify/Job' },
		{ id: '2', action: 'no_match', label: null },
		{ id: '3', action: 'needs_body', label: null },
		{ id: '4', action: 'needs_body' },
	]);
});

test('mail labeling chooses the lowest supported profile-model reasoning effort', () => {
	assert.equal(reasoningEffortForMail('openai', 'gpt-5.4-mini'), 'none');
	assert.equal(reasoningEffortForMail('openai', 'gpt-5-nano'), 'minimal');
	assert.equal(reasoningEffortForMail('openai', 'gpt-4o-mini'), undefined);
	assert.equal(reasoningEffortForMail('deepseek', 'deepseek-v4-flash'), undefined);
});

test('optimistic label patches retain Firestore document IDs for atomic writes', () => {
	const patch = optimisticFlagPatch({
		uid: 42,
		mailbox: 'INBOX',
		doc: {
			_id: 'mail-document-id',
			labels: [],
			gmailLabels: ['Important'],
			folder: 'inbox',
			flags: { seen: false, flagged: false },
		},
	}, 'Application');
	assert.equal(patch._id, 'mail-document-id');
	assert.deepEqual(patch.labels, ['Application']);
	assert.deepEqual(patch.gmailLabels, ['Important', 'Application']);
});

test('optimistic label patches tolerate malformed cached label fields', () => {
	const patch = optimisticFlagPatch({
		uid: 43,
		mailbox: 'INBOX',
		doc: { labels: null, gmailLabels: {}, folder: 'inbox' },
	}, 'Focus');
	assert.deepEqual(patch.labels, ['Focus']);
	assert.deepEqual(patch.gmailLabels, ['Focus']);
});
