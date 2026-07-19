/**
 * In-process async concurrency limiters with FIFO queuing (no 429 rejections).
 * Env knobs are read at factory-call time so tests can override process.env first.
 *
 * Env knobs:
 *   RESUME_GEN_GLOBAL_CONCURRENCY (default 32)
 *   RESUME_GEN_PER_USER_CONCURRENCY (default 12)
 *   PDF_RENDER_CONCURRENCY (default 16)
 *   LLM_GLOBAL_CONCURRENCY (default 48)
 *   MAIL_AI_LABEL_CONCURRENCY (default 8)
 */

export const DEFAULT_RESUME_GEN_GLOBAL_CONCURRENCY = 32;
export const DEFAULT_RESUME_GEN_PER_USER_CONCURRENCY = 12;
/** Match resume throughput — override via PDF_RENDER_CONCURRENCY. */
export const DEFAULT_PDF_RENDER_CONCURRENCY = 16;
export const DEFAULT_LLM_GLOBAL_CONCURRENCY = 48;
export const DEFAULT_MAIL_AI_LABEL_CONCURRENCY = 8;

/** Lower number = higher priority for LLM admission. */
export const LLM_PRIORITY = {
	agent: 0,
	resume: 1,
	mail: 2,
	skill: 3,
	other: 4,
};

function envInt(name, fallback) {
	const n = Number.parseInt(String(process.env[name] ?? ''), 10);
	return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function getResumeGenGlobalConcurrency() {
	return envInt('RESUME_GEN_GLOBAL_CONCURRENCY', DEFAULT_RESUME_GEN_GLOBAL_CONCURRENCY);
}

export function getResumeGenPerUserConcurrency() {
	return envInt('RESUME_GEN_PER_USER_CONCURRENCY', DEFAULT_RESUME_GEN_PER_USER_CONCURRENCY);
}

export function getPdfRenderConcurrency() {
	return envInt('PDF_RENDER_CONCURRENCY', DEFAULT_PDF_RENDER_CONCURRENCY);
}

export function getLlmGlobalConcurrency() {
	return envInt('LLM_GLOBAL_CONCURRENCY', DEFAULT_LLM_GLOBAL_CONCURRENCY);
}

export function getMailAiLabelConcurrency() {
	return envInt('MAIL_AI_LABEL_CONCURRENCY', DEFAULT_MAIL_AI_LABEL_CONCURRENCY);
}

/**
 * Map an LLM `feature` string to an admission priority band.
 * @param {string} [feature]
 * @returns {keyof typeof LLM_PRIORITY}
 */
export function llmPriorityFromFeature(feature) {
	const f = String(feature || '').toLowerCase();
	if (/^agent|otp|verification|avalon|form-analyz|injection|recover|verify/.test(f)) return 'agent';
	if (/resume/.test(f)) return 'resume';
	if (/mail|label|ai-write|ai-label/.test(f)) return 'mail';
	if (/skill|extract|match-score|embedding/.test(f)) return 'skill';
	return 'other';
}

/**
 * Simple async semaphore. Waiters are granted slots in FIFO order.
 */
export function createLimiter({ concurrency }) {
	const max = Math.max(1, concurrency);
	let active = 0;
	const waiters = [];

	function tryDrain() {
		while (active < max && waiters.length > 0) {
			active++;
			const { resolve } = waiters.shift();
			resolve();
		}
	}

	function acquire() {
		return new Promise((resolve) => {
			if (active < max) {
				active++;
				resolve();
			} else {
				waiters.push({ resolve });
			}
		});
	}

	function release() {
		if (active <= 0) return;
		active--;
		tryDrain();
	}

	async function run(fn) {
		await acquire();
		try {
			return await fn();
		} finally {
			release();
		}
	}

	return {
		acquire,
		release,
		run,
		get active() {
			return active;
		},
		get pending() {
			return waiters.length;
		},
	};
}

/**
 * Fair limiter: a waiter needs both a global slot and a per-key slot.
 * When the queue head cannot be granted (per-key saturated), later waiters
 * that *can* be granted are served — but a key never jumps ahead of its own
 * earlier waiter.
 */
export function createFairLimiter({ globalConcurrency, perKeyConcurrency }) {
	const globalMax = Math.max(1, globalConcurrency);
	const perKeyMax = Math.max(1, perKeyConcurrency);
	let globalActive = 0;
	const perKeyActive = new Map();
	const waiters = [];

	function keyCount(key) {
		return perKeyActive.get(key) ?? 0;
	}

	function canGrant(key) {
		return globalActive < globalMax && keyCount(key) < perKeyMax;
	}

	function grant(key) {
		globalActive++;
		perKeyActive.set(key, keyCount(key) + 1);
	}

	function revoke(key) {
		globalActive = Math.max(0, globalActive - 1);
		const next = keyCount(key) - 1;
		if (next <= 0) {
			perKeyActive.delete(key);
		} else {
			perKeyActive.set(key, next);
		}
	}

	function makeRelease(key) {
		let released = false;
		return function releaseSlot() {
			if (released) return;
			released = true;
			revoke(key);
			tryDrain();
		};
	}

	/**
	 * Keys that already have an earlier waiter still ahead in the queue must
	 * not be granted — preserves per-key FIFO while allowing cross-key skip.
	 */
	function tryDrain() {
		const blockedKeys = new Set();
		let i = 0;
		while (i < waiters.length && globalActive < globalMax) {
			const waiter = waiters[i];
			if (blockedKeys.has(waiter.key)) {
				i += 1;
				continue;
			}
			if (!canGrant(waiter.key)) {
				blockedKeys.add(waiter.key);
				i += 1;
				continue;
			}
			waiters.splice(i, 1);
			grant(waiter.key);
			waiter.resolve(makeRelease(waiter.key));
			// Do not increment i — next item shifted into this index.
		}
	}

	function acquire(key) {
		const normalizedKey = String(key ?? '');
		return new Promise((resolve) => {
			if (waiters.length === 0 && canGrant(normalizedKey)) {
				grant(normalizedKey);
				resolve(makeRelease(normalizedKey));
			} else {
				waiters.push({ key: normalizedKey, resolve });
				tryDrain();
			}
		});
	}

	/**
	 * @param {string} key
	 * @param {() => Promise<unknown>} fn
	 * @param {{ onQueued?: () => void | Promise<void> }} [opts]
	 */
	async function run(key, fn, opts = {}) {
		const normalizedKey = String(key ?? '');
		const needsWait = waiters.length > 0 || !canGrant(normalizedKey);
		if (needsWait && opts.onQueued) await opts.onQueued();
		const releaseSlot = await acquire(normalizedKey);
		try {
			return await fn();
		} finally {
			releaseSlot();
		}
	}

	return {
		acquire,
		run,
		get globalActive() {
			return globalActive;
		},
		get pending() {
			return waiters.length;
		},
		keyActive(key) {
			return keyCount(String(key ?? ''));
		},
	};
}

/**
 * Priority admission pool: lower priority number is served first.
 * Within the same priority, FIFO.
 *
 * @param {{ concurrency: number }} opts
 */
export function createPriorityLimiter({ concurrency }) {
	const max = Math.max(1, concurrency);
	let active = 0;
	/** @type {Array<{ priority: number, seq: number, resolve: () => void }>} */
	const waiters = [];
	let seq = 0;

	function sortWaiters() {
		waiters.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
	}

	function tryDrain() {
		sortWaiters();
		while (active < max && waiters.length > 0) {
			active++;
			const { resolve } = waiters.shift();
			resolve();
		}
	}

	function acquire(priority = LLM_PRIORITY.other) {
		const p = Number.isFinite(priority) ? priority : LLM_PRIORITY.other;
		return new Promise((resolve) => {
			if (active < max && waiters.length === 0) {
				active++;
				resolve();
			} else {
				waiters.push({ priority: p, seq: seq++, resolve });
				tryDrain();
			}
		});
	}

	function release() {
		if (active <= 0) return;
		active--;
		tryDrain();
	}

	/**
	 * @param {number} priority
	 * @param {() => Promise<unknown>} fn
	 * @param {{ onQueued?: (pending: number) => void | Promise<void> }} [opts]
	 */
	async function run(priority, fn, opts = {}) {
		const needsWait = active >= max || waiters.length > 0;
		if (needsWait && opts.onQueued) await opts.onQueued(waiters.length + 1);
		await acquire(priority);
		try {
			return await fn();
		} finally {
			release();
		}
	}

	return {
		acquire,
		release,
		run,
		get active() {
			return active;
		},
		get pending() {
			return waiters.length;
		},
	};
}

/**
 * Run `fn` over `items` with at most `concurrency` in flight.
 * Results preserve input order.
 *
 * @template T, R
 * @param {T[]} items
 * @param {number} concurrency
 * @param {(item: T, index: number) => Promise<R>} fn
 * @returns {Promise<R[]>}
 */
export async function mapPool(items, concurrency, fn) {
	const list = Array.isArray(items) ? items : [];
	const max = Math.max(1, concurrency | 0);
	const results = new Array(list.length);
	let next = 0;

	async function worker() {
		while (true) {
			const i = next++;
			if (i >= list.length) return;
			results[i] = await fn(list[i], i);
		}
	}

	const workers = Array.from({ length: Math.min(max, list.length || 1) }, () => worker());
	await Promise.all(workers);
	return results;
}

export function createResumeGenFairLimiter() {
	return createFairLimiter({
		globalConcurrency: getResumeGenGlobalConcurrency(),
		perKeyConcurrency: getResumeGenPerUserConcurrency(),
	});
}

export function createPdfRenderLimiter() {
	return createLimiter({
		concurrency: getPdfRenderConcurrency(),
	});
}

export function createLlmAdmissionPool() {
	return createPriorityLimiter({
		concurrency: getLlmGlobalConcurrency(),
	});
}

/** Shared process-wide limiters used by resume gen + PDF render + LLM paths. */
export const resumeGenLimiter = createResumeGenFairLimiter();
export const pdfRenderLimiter = createPdfRenderLimiter();
export const llmAdmissionPool = createLlmAdmissionPool();
