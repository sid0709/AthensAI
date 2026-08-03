export const SCRAPE_OUTCOMES = Object.freeze({
	REGISTERED: 'registered',
	DUPLICATE: 'duplicate',
	VALIDATION: 'validation',
	BLOCKED: 'blocked',
	FAILED: 'failed',
});

export function createScrapeRunStats() {
	return {
		registered: 0,
		duplicate: 0,
		validation: 0,
		blocked: 0,
		failed: 0,
	};
}

export function classifyJobSaveResult(result) {
	if (result?.created === true && result?.success !== false) return SCRAPE_OUTCOMES.REGISTERED;
	if (result?.duplicate === true) return SCRAPE_OUTCOMES.DUPLICATE;
	if (String(result?.reason || '').toLowerCase().includes('blocked by rule')) {
		return SCRAPE_OUTCOMES.BLOCKED;
	}
	return SCRAPE_OUTCOMES.FAILED;
}

export function incrementScrapeRunStats(stats, outcome) {
	if (!Object.values(SCRAPE_OUTCOMES).includes(outcome)) return stats;
	return { ...stats, [outcome]: stats[outcome] + 1 };
}

export function getSkippedScrapeCount(stats) {
	return stats.duplicate + stats.validation + stats.blocked;
}
