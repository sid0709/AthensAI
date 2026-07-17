/* global chrome */
import { persistSpiritApiUrlToStorage } from './config/env.js';

chrome.sidePanel
	.setPanelBehavior({ openPanelOnActionClick: true })
	.catch((error) => console.error(error));

// Actions that need to be sent to the content script
const actionsToForward = [
	"highlightByPattern",
	"highlightBySelectors",
	"highlightInteractables",
	"executePlan",
	"collectDomHints",
	"clearHighlight",
	"executeAction",
	"executeActionsSequence",
	"executeActionsParallel"
];

const JOB_BID_STORAGE_KEY = 'jobBidStore';
const MAX_RECENT_JOB_EVENTS = 5;
const MAX_TRACKED_JOBS = 500;
const pendingStoreTasks = [];
let storeReady = false;

async function ensureContentScriptInjected(tabId) {
	try {
		const [{ result }] = await chrome.scripting.executeScript({
			target: { tabId, frameIds: [0] },
			func: () => {
				const ATTR = 'data-autolancer-content-script-injected';
				const root = document.documentElement || document.head || document.body;
				if (!root) return false;
				// Only *check* if injected. Do not set any flags here because the content script
				// uses the same guards and would skip initialization if we pre-set them.
				return !(root.hasAttribute(ATTR) || window.contentScriptInjected);
			},
		});

		if (result) {
			await chrome.scripting.executeScript({
				target: { tabId, frameIds: [0] },
				files: ["contentScript.js"],
			});
		}
		return true;
	} catch (e) {
		console.error('Failed to ensure content script injection', e);
		return false;
	}
}

const createDefaultStore = () => ({
	stats: {
		total: 0,
		recent: []
	},
	jobs: {},
	lastResetAt: Date.now()
});

let jobBidStore = createDefaultStore();
let jobBidStatusState = {
	state: 'idle',
	jobUrl: '',
	buttonText: '',
	matchedUrl: '',
	timestamp: Date.now()
};

function normalizeStore(rawStore) {
	const defaults = createDefaultStore();
	if (!rawStore || typeof rawStore !== 'object') return defaults;

	const stats = rawStore.stats && typeof rawStore.stats === 'object' ? rawStore.stats : {};
	const normalizedStats = {
		total: Number.isFinite(stats.total) ? stats.total : 0,
		recent: Array.isArray(stats.recent) ? stats.recent.slice(0, MAX_RECENT_JOB_EVENTS) : []
	};

	const normalizedJobs = {};
	const rawJobs = rawStore.jobs && typeof rawStore.jobs === 'object' ? rawStore.jobs : {};
	for (const [key, value] of Object.entries(rawJobs)) {
		if (typeof value === 'number' && Number.isFinite(value)) {
			normalizedJobs[key] = value;
		}
	}
	const jobEntries = Object.entries(normalizedJobs).sort((a, b) => a[1] - b[1]);
	const trimmedJobs = jobEntries.length > MAX_TRACKED_JOBS
		? Object.fromEntries(jobEntries.slice(jobEntries.length - MAX_TRACKED_JOBS))
		: normalizedJobs;

	const lastResetAt = Number.isFinite(rawStore.lastResetAt) ? rawStore.lastResetAt : defaults.lastResetAt;

	return {
		stats: normalizedStats,
		jobs: trimmedJobs,
		lastResetAt
	};
}

function safeSendMessage(message) {
	try {
		const result = chrome.runtime?.sendMessage?.(message);
		if (result && typeof result.catch === 'function') {
			result.catch(() => { });
		}
	} catch (e) {
		// Ignore missing receivers; log unexpected errors
		if (!/Receiving end does not exist/.test(String(e))) {
			console.error('Failed to send runtime message', e);
		}
	}
}

function persistJobBidStore() {
	try {
		chrome.storage?.local?.set({ [JOB_BID_STORAGE_KEY]: jobBidStore }, () => {
			if (chrome.runtime.lastError) {
				console.error('Failed to persist job bid store', chrome.runtime.lastError);
			}
		});
	} catch (e) {
		console.error('Error persisting job bid store', e);
	}
}

function broadcastJobBidStats() {
	const payload = {
		total: jobBidStore.stats.total,
		recent: jobBidStore.stats.recent,
		lastResetAt: jobBidStore.lastResetAt
	};
	safeSendMessage({ action: 'jobBidStats', payload });
}

function broadcastJobBidStatusState() {
	safeSendMessage({ action: 'jobBidStatus:update', payload: jobBidStatusState });
}

function updateJobBidStatus(nextState) {
	jobBidStatusState = {
		...jobBidStatusState,
		...nextState,
		timestamp: nextState?.timestamp || Date.now()
	};
	broadcastJobBidStatusState();
}

function normalizeJobUrl(jobUrl) {
	if (!jobUrl || typeof jobUrl !== 'string') return null;
	try {
		const parsed = new URL(jobUrl);
		parsed.hash = '';
		let pathname = parsed.pathname || '';
		pathname = pathname.replace(/\/+$/, '');
		if (!pathname.startsWith('/')) pathname = `/${pathname}`;
		const params = new URLSearchParams(parsed.search || '');
		const sortedEntries = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b));
		const normalizedSearch = sortedEntries.length
			? `?${sortedEntries.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&')}`
			: '';
		return `${parsed.origin}${pathname}${normalizedSearch}`;
	} catch (e) {
		console.error('Failed to normalize job URL', e);
		return jobUrl.trim() || null;
	}
}

function sameHost(urlA, urlB) {
	try {
		const hostA = new URL(urlA).host;
		const hostB = new URL(urlB).host;
		return hostA === hostB;
	} catch (e) {
		console.error('Failed to compare hosts for URLs', e);
		return false;
	}
}

function findDuplicateJob(jobKey) {
	if (!jobKey) return null;
	for (const [storedKey, firstDetectedAt] of Object.entries(jobBidStore.jobs)) {
		if (!storedKey) continue;
		if (storedKey === jobKey) {
			return { storedKey, firstDetectedAt };
		}
		if (sameHost(jobKey, storedKey) && (storedKey.includes(jobKey) || jobKey.includes(storedKey))) {
			return { storedKey, firstDetectedAt };
		}
	}
	return null;
}

function notifyDuplicate(jobUrl, buttonText, firstDetectedAt, matchedUrl) {
	const payload = {
		jobUrl: jobUrl || '',
		buttonText: buttonText || '',
		firstDetectedAt,
		againDetectedAt: Date.now(),
		matchedUrl: matchedUrl || ''
	};
	safeSendMessage({ action: 'jobBidDuplicate', payload });
	updateJobBidStatus({
		state: 'duplicate',
		jobUrl: jobUrl || matchedUrl || '',
		buttonText: buttonText || '',
		firstDetectedAt,
		matchedUrl: matchedUrl || ''
	});
}

function enforceJobLimit() {
	const jobEntries = Object.entries(jobBidStore.jobs);
	if (jobEntries.length <= MAX_TRACKED_JOBS) return;
	jobEntries.sort((a, b) => a[1] - b[1]);
	jobBidStore.jobs = Object.fromEntries(jobEntries.slice(jobEntries.length - MAX_TRACKED_JOBS));
}

function withStoreReady(task) {
	if (storeReady) {
		task();
		return;
	}
	pendingStoreTasks.push(task);
}

function flushPendingStoreTasks() {
	if (!pendingStoreTasks.length) return;
	const tasks = pendingStoreTasks.splice(0, pendingStoreTasks.length);
	for (const task of tasks) {
		try {
			task();
		} catch (e) {
			console.error('Pending store task failed', e);
		}
	}
}

function recordJobBid(payload) {
	withStoreReady(() => {
		const timestamp = payload?.timestamp || Date.now();
		const jobUrl = payload?.jobUrl || payload?.urlAfter || payload?.urlBefore || '';
		const jobKey = normalizeJobUrl(jobUrl);

		const duplicate = findDuplicateJob(jobKey);
		if (duplicate) {
			notifyDuplicate(jobUrl, payload?.buttonText, duplicate.firstDetectedAt, duplicate.storedKey);
			return;
		}

		if (jobKey) {
			jobBidStore.jobs[jobKey] = timestamp;
			enforceJobLimit();
		}

		jobBidStore.stats.total += 1;
		const recentEvent = {
			id: timestamp,
			buttonText: payload?.buttonText || '',
			buttonSignature: payload?.buttonSignature || '',
			reason: payload?.reason || 'unknown',
			jobUrl: jobUrl,
			urlBefore: payload?.urlBefore || '',
			urlAfter: payload?.urlAfter || '',
			matchedKeyword: payload?.matchedKeyword || null,
			domChangePercent: typeof payload?.domChangePercent === 'number' ? payload.domChangePercent : null,
			timestamp
		};
		jobBidStore.stats.recent = [recentEvent, ...jobBidStore.stats.recent].slice(0, MAX_RECENT_JOB_EVENTS);
		persistJobBidStore();
		broadcastJobBidStats();
		updateJobBidStatus({
			state: 'counted',
			jobUrl,
			buttonText: payload?.buttonText || '',
			matchedUrl: ''
		});
	});
}

function resetJobBidStats() {
	withStoreReady(() => {
		jobBidStore = createDefaultStore();
		persistJobBidStore();
		broadcastJobBidStats();
		updateJobBidStatus({ state: 'idle', jobUrl: '' });
	});
}

function loadJobBidStore() {
	try {
		chrome.storage?.local?.get(JOB_BID_STORAGE_KEY, (items) => {
			if (chrome.runtime.lastError) {
				console.error('Failed to read job bid store', chrome.runtime.lastError);
				jobBidStore = createDefaultStore();
				persistJobBidStore();
				storeReady = true;
				flushPendingStoreTasks();
				broadcastJobBidStats();
				broadcastJobBidStatusState();
				return;
			}
			const stored = items?.[JOB_BID_STORAGE_KEY];
			if (!stored) {
				jobBidStore = createDefaultStore();
				persistJobBidStore();
				storeReady = true;
				flushPendingStoreTasks();
				broadcastJobBidStats();
				broadcastJobBidStatusState();
				return;
			}
			jobBidStore = normalizeStore(stored);
			storeReady = true;
			flushPendingStoreTasks();
			broadcastJobBidStats();
			broadcastJobBidStatusState();
		});
	} catch (e) {
		console.error('Error loading job bid store', e);
		jobBidStore = createDefaultStore();
		storeReady = true;
		flushPendingStoreTasks();
		broadcastJobBidStats();
		broadcastJobBidStatusState();
	}
}

function handleJobBidMessage(message) {
	switch (message?.action) {
		case 'jobBidApplied':
			recordJobBid(message.payload || {});
			return true;
		case 'jobBidStatus':
			updateJobBidStatus(message.payload || {});
			return true;
		case 'jobBidStatus:get':
			broadcastJobBidStatusState();
			return true;
		case 'jobBid:getStats':
			broadcastJobBidStats();
			return true;
		case 'jobBid:reset':
			resetJobBidStats();
			return true;
		default:
			return false;
	}
}

loadJobBidStore();
persistSpiritApiUrlToStorage();

// Messages coming from content scripts that should be relayed to the extension UI
// Listen for messages from the UI and forward them to the content script or to backend
function readStorageValue(key) {
	return new Promise((resolve) => {
		try {
			chrome.storage?.local?.get?.(key, (result) => {
				if (chrome.runtime?.lastError) {
					resolve(null);
					return;
				}
				resolve(result?.[key] ?? null);
			});
		} catch {
			resolve(null);
		}
	});
}

function normalizeBaseUrl(raw) {
	const value = typeof raw === 'string' ? raw.trim() : '';
	if (!value) return '';
	return value.endsWith('/') ? value.slice(0, -1) : value;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	// Content script -> background: read a local file via core-backend and return base64.
	if (message?.action === 'readLocalFile') {
		(async () => {
			try {
				const baseUrl = normalizeBaseUrl(await readStorageValue('spiritApiBaseUrl'));
				if (!baseUrl) {
					sendResponse?.({ success: false, error: 'spiritApiBaseUrl not set' });
					return;
				}

				const filePath = message?.payload?.path;
				if (!filePath || typeof filePath !== 'string') {
					sendResponse?.({ success: false, error: 'Missing payload.path' });
					return;
				}

				const resp = await fetch(`${baseUrl}/local-file`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ path: filePath })
				});
				if (!resp.ok) {
					const text = await resp.text().catch(() => '');
					sendResponse?.({ success: false, error: `local-file failed (${resp.status}): ${text || resp.statusText}` });
					return;
				}
				const data = await resp.json();
				sendResponse?.({ success: true, data });
			} catch (e) {
				sendResponse?.({ success: false, error: String(e && e.message || e) });
			}
		})();

		return true;
	}

	// UI -> background command: open multiple tabs (payload: { urls: [] })
	if (message.action === 'open-tabs') {
		const urls = message.payload && Array.isArray(message.payload.urls) ? message.payload.urls : [];
		if (!urls.length) return;
		for (const url of urls) {
			try {
				chrome.tabs.create({ url, active: false });
			} catch (e) {
				console.error('Failed to open tab for', url, e);
			}
		}
		return;
	}

	if (handleJobBidMessage(message)) {
		return;
	}

	if (actionsToForward.includes(message.action)) {
		chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
			if (!tabs?.length || !tabs[0]?.id) return;
			const targetTabId = tabs[0].id;
			chrome.tabs.sendMessage(targetTabId, message, { frameId: 0 }, () => {
				if (!chrome.runtime.lastError) return;
				const lastErrorMessage = chrome.runtime.lastError?.message || '';
				// Only attempt the guarded injection if the receiver is missing (navigation/new page).
				if (!/Receiving end does not exist|Could not establish connection/i.test(lastErrorMessage)) return;

				ensureContentScriptInjected(targetTabId)
					.then(() => {
						try {
							chrome.tabs.sendMessage(targetTabId, message, { frameId: 0 }, () => {
								// Read lastError so Chrome does not surface a noisy unchecked runtime warning.
								void chrome.runtime.lastError;
							});
						} catch (e) {
							console.error('Failed to send message after ensuring contentScript', e);
						}
					})
					.catch((err) => {
						console.error('Failed to ensure contentScript before resend', err);
					});
			});
		});
		return;
	}

});
