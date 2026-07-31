import { createLimiter } from '../../utils/concurrency.js';
import { assertBackgroundTaskActive } from './taskContext.js';

function boundedEnv(name, fallback) {
	const value = Number.parseInt(String(process.env[name] || ''), 10);
	return Math.max(1, Math.min(64, Number.isFinite(value) ? value : fallback));
}

function guardedLimiter(limiter) {
	return {
		acquire: limiter.acquire,
		release: limiter.release,
		run: (operation) => limiter.run(async () => {
			await assertBackgroundTaskActive();
			return operation();
		}),
		get active() { return limiter.active; },
		get pending() { return limiter.pending; },
	};
}

/** Shared process-wide dependency ceilings used by every background workflow. */
export const firestoreMutationLimiter = guardedLimiter(createLimiter({
	concurrency: boundedEnv('BACKGROUND_FIRESTORE_MUTATION_CONCURRENCY', 8),
}));

export const indexMutationLimiter = guardedLimiter(createLimiter({
	concurrency: boundedEnv('BACKGROUND_INDEX_CONCURRENCY', 8),
}));
