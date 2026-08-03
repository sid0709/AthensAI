import assert from 'node:assert/strict';
import test from 'node:test';

import { parseDuplicateWindowDays } from './duplicateWindow.js';

test('parses a configured duplicate-check window in days', () => {
	assert.equal(parseDuplicateWindowDays('14'), 14);
	assert.equal(parseDuplicateWindowDays(30), 30);
});

test('rejects missing, fractional, and out-of-range duplicate windows', () => {
	for (const value of [undefined, '', '14.5', '0', '366', 'days']) {
		assert.equal(parseDuplicateWindowDays(value), null);
	}
});
