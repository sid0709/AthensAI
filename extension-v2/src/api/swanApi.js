/* global chrome */

/**
 * Fetch Jobright swan APIs from the bound Jobright tab so SESSION_ID is sent.
 * @param {{ url: string, method?: string, body?: unknown, headers?: Record<string, string> }} opts
 */
export function swanFetch(opts) {
	return new Promise((resolve) => {
		try {
			chrome.runtime.sendMessage({ action: 'swanFetch', payload: opts }, (response) => {
				if (chrome.runtime.lastError) {
					resolve({ success: false, error: chrome.runtime.lastError.message });
					return;
				}
				resolve(response || { success: false, error: 'No response from swanFetch' });
			});
		} catch (e) {
			resolve({ success: false, error: String(e?.message || e) });
		}
	});
}

export const JOBRIGHT_LIST_URL = 'https://jobright.ai/swan/recommend/list/jobs';
export const JOBRIGHT_APPLY_URL = 'https://jobright.ai/swan/job/apply';

/**
 * @param {{ refresh: boolean, position: number, count?: number }} params
 */
export function buildListJobsUrl({ refresh, position, count = 10 }) {
	const q = new URLSearchParams({
		refresh: refresh ? 'true' : 'false',
		sortCondition: '0',
		position: String(position),
		count: String(count),
		syncRerank: 'false',
	});
	return `${JOBRIGHT_LIST_URL}?${q.toString()}`;
}

function isTransientJobrightMessage(msg) {
	const text = String(msg || '').toLowerCase();
	return (
		text.includes('executionexception')
		|| text.includes('failed to get job list')
		|| text.includes('timeout')
		|| text.includes('timed out')
		|| text.includes('too many requests')
		|| text.includes('rate limit')
		|| text.includes('503')
		|| text.includes('502')
		|| text.includes('504')
		|| text.includes('failed to fetch')
		|| text.includes('network')
		|| text.includes('temporarily')
	);
}

/**
 * Jobright success envelope: errorCode 10000 means OK.
 * @param {{ success?: boolean, status?: number, data?: any, error?: string, ok?: boolean }} resp
 */
export function interpretSwanListResponse(resp) {
	if (!resp?.success) {
		const error = resp?.error || 'swanFetch failed';
		const transient = isTransientJobrightMessage(error);
		return {
			ok: false,
			sessionDead: false,
			retryable: true,
			error,
			jobs: [],
			transient,
		};
	}

	const status = resp.status;
	if (status === 401 || status === 403) {
		return {
			ok: false,
			sessionDead: true,
			retryable: false,
			error: `Jobright auth HTTP ${status}. Re-login on jobright.ai and retry.`,
			jobs: [],
		};
	}

	if (status === 429 || status === 502 || status === 503 || status === 504) {
		return {
			ok: false,
			sessionDead: false,
			retryable: true,
			error: `Jobright temporary HTTP ${status}. Will retry.`,
			jobs: [],
			transient: true,
		};
	}

	const data = resp.data;
	if (!data || typeof data !== 'object' || data.raw) {
		return {
			ok: false,
			sessionDead: false,
			retryable: true,
			error: 'Unexpected Jobright response body. Will retry.',
			jobs: [],
			transient: true,
		};
	}

	const errorMsg = data.errorMsg || data.message || '';
	const logicalFail = data.success === false
		|| (data.errorCode != null && data.errorCode !== 10000);

	if (logicalFail) {
		const msg = errorMsg || `Jobright logical failure (errorCode ${data.errorCode})`;
		if (isTransientJobrightMessage(msg)) {
			return {
				ok: false,
				sessionDead: false,
				retryable: true,
				error: msg,
				jobs: [],
				transient: true,
			};
		}
		return {
			ok: false,
			sessionDead: true,
			retryable: false,
			error: `${msg}. Re-login on jobright.ai and retry.`,
			jobs: [],
		};
	}

	const jobList = data.result?.jobList;
	if (!Array.isArray(jobList)) {
		return {
			ok: false,
			sessionDead: false,
			retryable: true,
			error: 'Jobright response missing result.jobList. Will retry.',
			jobs: [],
			transient: true,
		};
	}

	return {
		ok: true,
		sessionDead: false,
		retryable: false,
		error: null,
		jobs: jobList,
		impId: data.result?.impId,
	};
}

/**
 * @param {{ success?: boolean, status?: number, data?: any, error?: string }} resp
 */
export function interpretSwanApplyResponse(resp) {
	if (!resp?.success) {
		return { ok: false, error: resp?.error || 'swan apply failed', retryable: true };
	}
	if (resp.status === 401 || resp.status === 403) {
		return { ok: false, error: `Jobright apply auth HTTP ${resp.status}`, retryable: false };
	}
	if (resp.status === 429 || resp.status === 502 || resp.status === 503 || resp.status === 504) {
		return { ok: false, error: `Jobright apply HTTP ${resp.status}`, retryable: true };
	}
	const data = resp.data;
	if (!data || typeof data !== 'object' || data.raw) {
		return { ok: false, error: 'Unexpected apply response', retryable: true };
	}
	if (data.success === false || (data.errorCode != null && data.errorCode !== 10000)) {
		const msg = data.errorMsg || `apply errorCode ${data.errorCode}`;
		return {
			ok: false,
			error: msg,
			retryable: isTransientJobrightMessage(msg),
		};
	}
	return { ok: true, error: null, result: data.result };
}
