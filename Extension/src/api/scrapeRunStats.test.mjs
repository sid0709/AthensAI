import assert from 'node:assert/strict';
import test from 'node:test';

import {
	classifyJobSaveResult,
	createScrapeRunStats,
	formatElapsedTime,
	getSkippedScrapeCount,
	incrementScrapeRunStats,
	SCRAPE_OUTCOMES,
} from './scrapeRunStats.js';

test('classifies backend save results using their response contract', () => {
	assert.equal(
		classifyJobSaveResult({ success: true, created: true }),
		SCRAPE_OUTCOMES.REGISTERED,
	);
	assert.equal(
		classifyJobSaveResult({ success: false, created: false, duplicate: true }),
		SCRAPE_OUTCOMES.DUPLICATE,
	);
	assert.equal(
		classifyJobSaveResult({ success: false, created: false, reason: 'Blocked by rule: agency' }),
		SCRAPE_OUTCOMES.BLOCKED,
	);
	assert.equal(classifyJobSaveResult(null), SCRAPE_OUTCOMES.FAILED);
});

test('tracks registered, skipped reasons, and failures for one run', () => {
	let stats = createScrapeRunStats();
	for (const outcome of [
		SCRAPE_OUTCOMES.REGISTERED,
		SCRAPE_OUTCOMES.DUPLICATE,
		SCRAPE_OUTCOMES.VALIDATION,
		SCRAPE_OUTCOMES.BLOCKED,
		SCRAPE_OUTCOMES.FAILED,
	]) {
		stats = incrementScrapeRunStats(stats, outcome);
	}

	assert.deepEqual(stats, {
		registered: 1,
		duplicate: 1,
		validation: 1,
		blocked: 1,
		failed: 1,
	});
	assert.equal(getSkippedScrapeCount(stats), 3);
});

test('formats elapsed run time as a stable clock', () => {
	assert.equal(formatElapsedTime(0), '00:00');
	assert.equal(formatElapsedTime(65_900), '01:05');
	assert.equal(formatElapsedTime(3_723_000), '01:02:03');
});
