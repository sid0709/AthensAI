import assert from 'node:assert/strict';
import test from 'node:test';

import { editableAutoBidProfileFieldSet } from './personalInfoController.js';

test('general profile saves cannot overwrite the dedicated AI default', () => {
	const update = editableAutoBidProfileFieldSet({
		fullName: 'Updated User',
		defaultProvider: 'openai',
		defaultModel: 'gpt-5.4-mini',
		resumeUpdatedAt: 'server-managed',
	});

	assert.deepEqual(update, {
		'autoBidProfile.fullName': 'Updated User',
	});
	assert.equal(update['autoBidProfile.defaultProvider'], undefined);
	assert.equal(update['autoBidProfile.defaultModel'], undefined);
});
