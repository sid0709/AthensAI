/**
 * IMAP error enrichment and abort-aware retries for transient Gmail failures.
 */

const DEFAULT_ATTEMPTS = 3;
const BASE_DELAY_MS = 250;

function abortError(signal) {
	return signal?.reason instanceof Error
		? signal.reason
		: Object.assign(new Error('IMAP operation cancelled'), { name: 'AbortError' });
}

export function throwIfImapAborted(signal) {
	if (signal?.aborted) throw abortError(signal);
}

/**
 * Turn imapflow's generic "Command failed" into a message that includes
 * Gmail's responseStatus / responseText when present.
 */
export function formatImapError(error) {
	if (error == null) return 'Unknown IMAP error';
	if (typeof error === 'string') return error;

	const base = String(error.message || error).trim() || 'IMAP error';
	const status = String(error.responseStatus || '').trim().toUpperCase();
	const text = String(error.responseText || '').trim();
	if (!status && !text) return base;

	const detail = [status, text].filter(Boolean).join(' ');
	if (base.includes(detail)) return base;
	return `${base}: ${detail}`;
}

/**
 * True for imapflow command failures, connection drops, and pool exhaustion —
 * cases worth a short backoff retry. Never retries AbortError.
 */
export function isRetryableImapError(error, signal) {
	if (!error || signal?.aborted || error.name === 'AbortError') return false;

	const message = String(error.message || error);
	if (/^Command failed$/i.test(message.trim())) return true;
	if (/Command failed:/i.test(message)) return true;
	if (/IMAP connection pool exhausted/i.test(message)) return true;
	if (/ECONNRESET|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN|socket|closed|disconnected|not available/i.test(message)) {
		return true;
	}

	const status = String(error.responseStatus || '').toUpperCase();
	if (status === 'NO' || status === 'BAD') return true;

	return false;
}

function delay(ms, signal) {
	throwIfImapAborted(signal);
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			cleanup();
			resolve();
		}, ms);
		const onAbort = () => {
			cleanup();
			reject(abortError(signal));
		};
		const cleanup = () => {
			clearTimeout(timer);
			signal?.removeEventListener?.('abort', onAbort);
		};
		signal?.addEventListener?.('abort', onAbort, { once: true });
	});
}

/**
 * Run `fn` with exponential backoff on transient IMAP failures.
 * @param {() => Promise<T>} fn
 * @param {{ signal?: AbortSignal, attempts?: number, baseDelayMs?: number }} [options]
 * @returns {Promise<T>}
 */
export async function withImapRetry(fn, options = {}) {
	const attempts = Math.max(1, Number(options.attempts) || DEFAULT_ATTEMPTS);
	const baseDelayMs = Math.max(50, Number(options.baseDelayMs) || BASE_DELAY_MS);
	const signal = options.signal;
	let lastError;

	for (let attempt = 0; attempt < attempts; attempt += 1) {
		throwIfImapAborted(signal);
		try {
			return await fn();
		} catch (error) {
			lastError = error;
			if (!isRetryableImapError(error, signal) || attempt === attempts - 1) {
				const enriched = new Error(formatImapError(error));
				enriched.name = error?.name || 'Error';
				if (error?.responseStatus) enriched.responseStatus = error.responseStatus;
				if (error?.responseText) enriched.responseText = error.responseText;
				if (error?.executedCommand) enriched.executedCommand = error.executedCommand;
				enriched.cause = error;
				throw enriched;
			}
			await delay(baseDelayMs * 2 ** attempt, signal);
		}
	}

	throw new Error(formatImapError(lastError));
}
