/** Server endpoints — configure in Extension/.env only. */

function trimEnv(value) {
	const trimmed = typeof value === 'string' ? value.trim() : '';
	return trimmed || null;
}

function normalizeBaseUrl(raw) {
	if (!raw) return null;
	return raw.replace(/\/$/, '');
}

/** REST API base (scrap POST /jobs). */
export const API_URL = normalizeBaseUrl(trimEnv(import.meta.env.VITE_API_URL));

/** Spirit / autofill service (content script + Agent tab). */
export const SPIRIT_API_URL = normalizeBaseUrl(trimEnv(import.meta.env.VITE_SPIRIT_API_URL));

export const SPIRIT_API_STORAGE_KEY = 'spiritApiBaseUrl';

export function persistSpiritApiUrlToStorage() {
	if (!SPIRIT_API_URL || typeof chrome === 'undefined' || !chrome.storage?.local) return;

	try {
		chrome.storage.local.set({ [SPIRIT_API_STORAGE_KEY]: SPIRIT_API_URL });
	} catch (e) {
		console.error('Failed to persist Spirit API base URL from env', e);
	}
}
