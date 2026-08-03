import assert from 'node:assert/strict';
import test from 'node:test';

import {
	hasLiveExtensionRuntime,
	isExtensionContextInvalidatedError,
	sendRuntimeMessageSafely,
} from './contentScriptLifecycle.js';

test('recognizes an invalidated extension context', () => {
	assert.equal(isExtensionContextInvalidatedError(new Error('Extension context invalidated.')), true);
	assert.equal(isExtensionContextInvalidatedError(new Error('Receiving end does not exist')), false);
});

test('silently routes invalidated contexts to lifecycle cleanup', () => {
	let invalidated = 0;
	let reported = 0;
	const runtime = {
		id: 'extension-id',
		sendMessage() {
			throw new Error('Extension context invalidated.');
		},
	};

	assert.equal(sendRuntimeMessageSafely(runtime, { action: 'test' }, {
		onInvalidated: () => { invalidated += 1; },
		onError: () => { reported += 1; },
	}), false);
	assert.equal(invalidated, 1);
	assert.equal(reported, 0);
});

test('continues reporting genuine runtime messaging errors', () => {
	let reportedMessage = '';
	const runtime = {
		id: 'extension-id',
		sendMessage() {
			throw new Error('Receiving end does not exist');
		},
	};

	sendRuntimeMessageSafely(runtime, { action: 'test' }, {
		onError: (error) => { reportedMessage = error.message; },
	});
	assert.equal(reportedMessage, 'Receiving end does not exist');
	assert.equal(hasLiveExtensionRuntime({ id: '', sendMessage() {} }), false);
});
