import assert from 'node:assert/strict';
import test from 'node:test';

import {
	clearRememberedPageTab,
	getRememberedPageTab,
	isEligiblePageTab,
	rememberPageTab,
} from './interactionBridge.js';

test('remembers one eligible page tab until the scrape run clears it', () => {
	const jobTab = { id: 42, url: 'https://jobright.ai/jobs/recommend', title: 'Jobs' };
	assert.equal(isEligiblePageTab(jobTab), true);
	assert.deepEqual(rememberPageTab(jobTab), jobTab);
	assert.deepEqual(getRememberedPageTab(), jobTab);

	clearRememberedPageTab();
	assert.equal(getRememberedPageTab(), null);
});

test('rejects extension and browser-internal tabs as scrape targets', () => {
	assert.equal(isEligiblePageTab({ id: 1, url: 'chrome-extension://id/index.html' }), false);
	assert.equal(isEligiblePageTab({ id: 2, url: 'chrome://extensions' }), false);
	assert.equal(rememberPageTab({ id: 3, url: 'file:///tmp/job.html' }), null);
});
