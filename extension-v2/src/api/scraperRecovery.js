/* global chrome */
import { SCRAPER_RESTART_URL } from '../config/socket_protocol';

const BACKOFF_SLOTS_SEC = [5, 10, 20, 40, 80, 160, 200];

export function getBackoffDelay(attemptIndex) {
	const idx = Math.max(0, attemptIndex) % BACKOFF_SLOTS_SEC.length;
	return BACKOFF_SLOTS_SEC[idx] * 1000;
}

export function isNetworkError(err) {
	if (!err) return false;
	const message = String(err.message || err || '');
	if (err.name === 'TypeError' && /fetch|network|failed/i.test(message)) return true;
	if (/failed to fetch|networkerror|err_connection|econnrefused|econnreset/i.test(message)) return true;
	if (err.retryable === true || err.transient === true) return true;
	const status = err.status ?? err?.data?.status;
	if (status === 0 || status === 502 || status === 503 || status === 504 || status === 429) return true;
	return false;
}

export function isFetchTimeoutError(err) {
	return err?.name === 'ScraperFetchTimeout';
}

function sendBackgroundMessage(action, payload) {
	return new Promise((resolve) => {
		try {
			chrome.runtime.sendMessage({ action, payload }, (response) => {
				if (chrome.runtime.lastError) {
					resolve({ success: false, error: chrome.runtime.lastError.message });
					return;
				}
				resolve(response || { success: false, error: 'No response' });
			});
		} catch (e) {
			resolve({ success: false, error: String(e?.message || e) });
		}
	});
}

export async function bindScraperTab() {
	return sendBackgroundMessage('scraper:bind-tab');
}

export async function unbindScraperTab() {
	return sendBackgroundMessage('scraper:unbind-tab');
}

export async function reloadScraperTab() {
	return sendBackgroundMessage('scraper:reload');
}

export async function navigateScraperTab(url = SCRAPER_RESTART_URL) {
	return sendBackgroundMessage('scraper:navigate', { url });
}

export async function recoverScraperTab() {
	return sendBackgroundMessage('scraper:recover-tab');
}

export async function recoverScraper({ reason = 'unknown' } = {}) {
	console.warn('[scraper] recovery started:', reason);
	const result = await recoverScraperTab();
	if (!result?.success) {
		throw new Error(result?.error || 'Failed to recover scraper tab');
	}
	return { success: true };
}

export function waitMs(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export function withFetchTimeout(promise, timeoutMs = 60000) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			const err = new Error(`Fetch timed out after ${timeoutMs}ms`);
			err.name = 'ScraperFetchTimeout';
			reject(err);
		}, timeoutMs);

		Promise.resolve(promise)
			.then((value) => {
				clearTimeout(timer);
				resolve(value);
			})
			.catch((err) => {
				clearTimeout(timer);
				reject(err);
			});
	});
}
