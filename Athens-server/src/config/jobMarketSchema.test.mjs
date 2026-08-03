import assert from 'node:assert/strict';
import test from 'node:test';

import { stripScraperOnlyJobFields } from './jobMarketSchema.js';

test('removes the client duplicate window before job persistence', () => {
	const job = {
		title: 'Engineer',
		duplicateWindowDays: 14,
		tags: [],
	};
	assert.deepEqual(stripScraperOnlyJobFields(job), { title: 'Engineer' });
});
