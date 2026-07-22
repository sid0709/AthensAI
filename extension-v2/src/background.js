/* global chrome */
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

const SCRAPER_TAB_STORAGE_KEY = 'scraperTabIdV2';
const SCRAPER_ACTIVE_STORAGE_KEY = 'scraperActiveV2';
const JOBRIGHT_URL_PATTERN = '*://*.jobright.ai/*';
const SCRAPER_RESTART_URL = 'https://jobright.ai/jobs/recommend';

const JOB_BID_STORAGE_KEY = 'jobBidStore';
const MAX_RECENT_JOB_EVENTS = 5;
const MAX_TRACKED_JOBS = 500;
const pendingStoreTasks = [];
let storeReady = false;

async function ensureContentScriptInjected(tabId) {
	try {
		const tab = await chrome.tabs.get(tabId);
		if (!isScraperReadyTab(tab)) {
			return false;
		}

		const [{ result }] = await chrome.scripting.executeScript({
			target: { tabId, frameIds: [0] },
			func: () => {
				const ATTR = 'data-autolancer-content-script-injected';
				const root = document.documentElement || document.head || document.body;
				if (!root) return false;
				return !(root.hasAttribute(ATTR) || window.contentScriptInjected);
			},
		});

		const tabBeforeInject = await chrome.tabs.get(tabId);
		if (!isInjectableUrl(tabBeforeInject?.url)) {
			return false;
		}

		if (result) {
			await chrome.scripting.executeScript({
				target: { tabId, frameIds: [0] },
				files: ['contentScript.js'],
			});
		}
		return true;
	} catch (e) {
		if (!isIgnorableInjectionError(e)) {
			console.warn('Failed to ensure content script injection', e);
		}
		return false;
	}
}

function pingContentScript(tabId) {
	return new Promise((resolve) => {
		const timer = setTimeout(() => resolve(false), 3000);
		chrome.tabs.sendMessage(tabId, { action: 'scraper:ping' }, { frameId: 0 }, (response) => {
			clearTimeout(timer);
			resolve(Boolean(response?.ok) && !chrome.runtime.lastError);
		});
	});
}

async function forceRefreshContentScript(tabId) {
	const tab = await chrome.tabs.get(tabId).catch(() => null);
	if (!tab?.id || !isInjectableUrl(tab.url)) {
		return false;
	}

	await chrome.scripting.executeScript({
		target: { tabId, frameIds: [0] },
		func: () => {
			document.documentElement?.removeAttribute('data-autolancer-content-script-injected');
			try {
				delete window.contentScriptInjected;
			} catch {
				// ignore
			}
		},
	});

	await chrome.scripting.executeScript({
		target: { tabId, frameIds: [0] },
		files: ['contentScript.js'],
	});
	return true;
}

async function ensureScraperContentScript(tabId) {
	const tab = await chrome.tabs.get(tabId).catch(() => null);
	if (!tab?.id) return false;

	if (await pingContentScript(tabId)) {
		return true;
	}

	await forceRefreshContentScript(tabId);
	await new Promise((r) => setTimeout(r, 400));
	return pingContentScript(tabId);
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

// Persist the backend base URL from build-time env for content scripts.
try {
	const envBaseUrl = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_SPIRIT_API_URL)
		? import.meta.env.VITE_SPIRIT_API_URL
		: '';
	if (envBaseUrl && chrome?.storage?.local) {
		chrome.storage.local.set({ spiritApiBaseUrl: envBaseUrl });
	}
} catch (e) {
	// Best effort only.
	console.error('Failed to persist Spirit API base URL from env', e);
}

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

function isJobrightUrl(url) {
	if (!url || typeof url !== 'string') return false;
	try {
		return new URL(url).hostname.endsWith('jobright.ai');
	} catch {
		return false;
	}
}

function isInjectableUrl(url) {
	if (!url || typeof url !== 'string') return false;
	try {
		const protocol = new URL(url).protocol;
		return protocol === 'http:' || protocol === 'https:';
	} catch {
		return false;
	}
}

function isIgnorableInjectionError(err) {
	const message = String(err?.message || err || '');
	return /cannot access a chrome:|cannot access contents of url|extensions gallery|chrome-error/i.test(message);
}

function isScraperReadyTab(tab) {
	return Boolean(tab?.id && isInjectableUrl(tab.url) && isJobrightUrl(tab.url));
}

async function isScraperSessionActive() {
	const active = await readSessionValue(SCRAPER_ACTIVE_STORAGE_KEY);
	return active === true;
}

async function setScraperSessionActive(active) {
	await writeSessionValue(SCRAPER_ACTIVE_STORAGE_KEY, active ? true : null);
}

async function getPinnedTabRecord() {
	const pinnedTabId = await getScraperTabId();
	if (!pinnedTabId) return null;
	try {
		return await chrome.tabs.get(pinnedTabId);
	} catch {
		await setScraperTabId(null);
		return null;
	}
}

async function getTabSafe(tabId) {
	try {
		const tab = await chrome.tabs.get(tabId);
		if (!tab?.id || !isScraperReadyTab(tab)) return null;
		return tab;
	} catch {
		return null;
	}
}

async function ensureJobrightScraperTab() {
	const pinned = await getPinnedTabRecord();
	if (pinned?.id) {
		if (isScraperReadyTab(pinned)) {
			return pinned;
		}
		await chrome.tabs.update(pinned.id, { url: SCRAPER_RESTART_URL, active: false });
		await waitForTabComplete(pinned.id);
		return chrome.tabs.get(pinned.id);
	}

	const jobrightTabs = await chrome.tabs.query({ url: JOBRIGHT_URL_PATTERN });
	if (jobrightTabs?.length) {
		const tab = jobrightTabs[0];
		await setScraperTabId(tab.id);
		if (!isScraperReadyTab(tab)) {
			await chrome.tabs.update(tab.id, { url: SCRAPER_RESTART_URL, active: false });
			await waitForTabComplete(tab.id);
			return chrome.tabs.get(tab.id);
		}
		return tab;
	}

	const created = await chrome.tabs.create({ url: SCRAPER_RESTART_URL, active: false });
	await waitForTabComplete(created.id);
	await setScraperTabId(created.id);
	return created;
}

async function resolveScraperTargetTab() {
	const pinned = await getPinnedTabRecord();
	if (pinned?.id && isScraperReadyTab(pinned)) {
		return pinned;
	}

	const jobrightTabs = await chrome.tabs.query({ url: JOBRIGHT_URL_PATTERN });
	if (jobrightTabs?.length) {
		const tab = jobrightTabs.find((entry) => isScraperReadyTab(entry));
		if (tab) {
			await setScraperTabId(tab.id);
			return tab;
		}
	}

	return null;
}

function readSessionValue(key) {
	return new Promise((resolve) => {
		try {
			chrome.storage?.session?.get?.(key, (result) => {
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

function writeSessionValue(key, value) {
	return new Promise((resolve) => {
		try {
			if (value === null || value === undefined) {
				chrome.storage?.session?.remove?.(key, () => resolve());
				return;
			}
			chrome.storage?.session?.set?.({ [key]: value }, () => resolve());
		} catch {
			resolve();
		}
	});
}

async function getScraperTabId() {
	const stored = await readSessionValue(SCRAPER_TAB_STORAGE_KEY);
	return Number.isFinite(stored) ? stored : null;
}

async function setScraperTabId(tabId) {
	if (Number.isFinite(tabId)) {
		await writeSessionValue(SCRAPER_TAB_STORAGE_KEY, tabId);
	} else {
		await writeSessionValue(SCRAPER_TAB_STORAGE_KEY, null);
	}
}

async function resolveJobrightTab() {
	const [activeTabs, jobrightTabs] = await Promise.all([
		chrome.tabs.query({ active: true, currentWindow: true }),
		chrome.tabs.query({ url: JOBRIGHT_URL_PATTERN }),
	]);

	const activeTab = activeTabs?.[0];
	if (activeTab?.id && isJobrightUrl(activeTab.url)) {
		return activeTab;
	}

	if (jobrightTabs?.length) {
		return jobrightTabs.find((tab) => tab.id) || null;
	}

	return null;
}

function waitForTabComplete(tabId, timeoutMs = 60000) {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			chrome.tabs.onUpdated.removeListener(listener);
			reject(new Error('Tab load timed out'));
		}, timeoutMs);

		const listener = (updatedTabId, changeInfo) => {
			if (updatedTabId !== tabId || changeInfo.status !== 'complete') return;
			clearTimeout(timeout);
			chrome.tabs.onUpdated.removeListener(listener);
			resolve();
		};

		chrome.tabs.get(tabId, (tab) => {
			if (chrome.runtime.lastError) {
				clearTimeout(timeout);
				reject(new Error(chrome.runtime.lastError.message));
				return;
			}
			if (tab?.status === 'complete') {
				clearTimeout(timeout);
				resolve();
				return;
			}
			chrome.tabs.onUpdated.addListener(listener);
		});
	});
}

function sendMessageToTab(targetTabId, message) {
	return new Promise((resolve) => {
		getTabSafe(targetTabId).then((tab) => {
			if (!tab) {
				resolve(false);
				return;
			}

			chrome.tabs.sendMessage(targetTabId, message, { frameId: 0 }, () => {
				if (!chrome.runtime.lastError) {
					resolve(true);
					return;
				}
				const lastErrorMessage = chrome.runtime.lastError?.message || '';
				if (!/Receiving end does not exist|Could not establish connection/i.test(lastErrorMessage)) {
					resolve(false);
					return;
				}

				ensureContentScriptInjected(targetTabId)
					.then(() => {
						chrome.tabs.sendMessage(targetTabId, message, { frameId: 0 }, () => {
							void chrome.runtime.lastError;
							resolve(!chrome.runtime.lastError);
						});
					})
					.catch(() => {
						resolve(false);
					});
			});
		});
	});
}

async function forwardToContentScript(message) {
	const scraperActive = await isScraperSessionActive();
	const pinnedTabId = await getScraperTabId();

	if (scraperActive || pinnedTabId) {
		const tab = await resolveScraperTargetTab();
		if (tab?.id) {
			await sendMessageToTab(tab.id, message);
		}
		return;
	}

	const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
	const activeTab = tabs?.[0];
	if (!activeTab?.id || !isInjectableUrl(activeTab.url)) return;
	await sendMessageToTab(activeTab.id, message);
}

async function handleScraperRecoverTab(sendResponse) {
	try {
		const tab = await ensureJobrightScraperTab();
		await setScraperTabId(tab.id);
		await setScraperSessionActive(true);
		const ready = await ensureScraperContentScript(tab.id);
		if (!ready) {
			sendResponse?.({ success: false, error: 'Content script is not responding after recovery' });
			return;
		}
		await new Promise((r) => setTimeout(r, 500));
		sendResponse?.({ success: true, tabId: tab.id, url: tab.url || '' });
	} catch (e) {
		sendResponse?.({ success: false, error: String(e?.message || e) });
	}
}

async function handleScraperBindTab(sendResponse) {
	try {
		const tab = await ensureJobrightScraperTab();
		await setScraperTabId(tab.id);
		await setScraperSessionActive(true);
		const ready = await ensureScraperContentScript(tab.id);
		if (!ready) {
			sendResponse?.({ success: false, error: 'Content script is not responding on Jobright tab. Refresh the tab and try again.' });
			return;
		}
		await new Promise((r) => setTimeout(r, 500));
		sendResponse?.({ success: true, tabId: tab.id, url: tab.url || '' });
	} catch (e) {
		sendResponse?.({ success: false, error: String(e?.message || e) });
	}
}

async function handleScraperUnbindTab(sendResponse) {
	try {
		await setScraperTabId(null);
		await setScraperSessionActive(false);
		sendResponse?.({ success: true });
	} catch (e) {
		sendResponse?.({ success: false, error: String(e?.message || e) });
	}
}

async function handleScraperReload(sendResponse) {
	try {
		const tab = await getPinnedTabRecord();
		if (!tab?.id) {
			sendResponse?.({ success: false, error: 'No pinned scraper tab' });
			return;
		}
		await chrome.tabs.reload(tab.id);
		await waitForTabComplete(tab.id);
		await ensureScraperContentScript(tab.id);
		await new Promise((r) => setTimeout(r, 1500));
		sendResponse?.({ success: true });
	} catch (e) {
		sendResponse?.({ success: false, error: String(e?.message || e) });
	}
}

async function handleScraperNavigate(url, sendResponse) {
	try {
		const tab = await ensureJobrightScraperTab();
		await setScraperTabId(tab.id);
		await setScraperSessionActive(true);
		await chrome.tabs.update(tab.id, { url });
		await waitForTabComplete(tab.id);
		await ensureScraperContentScript(tab.id);
		await new Promise((r) => setTimeout(r, 1500));
		sendResponse?.({ success: true, tabId: tab.id });
	} catch (e) {
		sendResponse?.({ success: false, error: String(e?.message || e) });
	}
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
	if (changeInfo.status !== 'complete') return;
	getScraperTabId().then(async (pinnedId) => {
		if (pinnedId !== tabId) return;
		const tab = await chrome.tabs.get(tabId).catch(() => null);
		if (isScraperReadyTab(tab)) {
			await ensureScraperContentScript(tabId);
		}
	});
});

chrome.tabs.onRemoved.addListener((tabId) => {
	getScraperTabId().then((pinnedId) => {
		if (pinnedId !== tabId) return;
		setScraperTabId(null);
		setScraperSessionActive(false);
		safeSendMessage({ action: 'scraper:tab-closed', payload: { tabId } });
	});
});

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

	if (message.action === 'scraper:recover-tab') {
		handleScraperRecoverTab(sendResponse);
		return true;
	}

	if (message.action === 'scraper:bind-tab') {
		handleScraperBindTab(sendResponse);
		return true;
	}

	if (message.action === 'scraper:unbind-tab') {
		handleScraperUnbindTab(sendResponse);
		return true;
	}

	if (message.action === 'scraper:reload') {
		handleScraperReload(sendResponse);
		return true;
	}

	if (message.action === 'scraper:navigate') {
		const url = message?.payload?.url;
		if (!url || typeof url !== 'string') {
			sendResponse?.({ success: false, error: 'Missing payload.url' });
			return true;
		}
		handleScraperNavigate(url, sendResponse);
		return true;
	}

	// Side panel -> Jobright tab fetch (cookies / SESSION_ID automatic)
	if (message.action === 'swanFetch') {
		(async () => {
			try {
				const tab = await resolveScraperTargetTab();
				if (!tab?.id) {
					sendResponse?.({ success: false, error: 'No Jobright scraper tab bound' });
					return;
				}
				const ready = await ensureScraperContentScript(tab.id);
				if (!ready) {
					sendResponse?.({ success: false, error: 'Content script is not responding on Jobright tab' });
					return;
				}
				const result = await chrome.tabs.sendMessage(tab.id, message);
				sendResponse?.(result || { success: false, error: 'Empty swanFetch response' });
			} catch (e) {
				sendResponse?.({ success: false, error: String(e?.message || e) });
			}
		})();
		return true;
	}

	if (actionsToForward.includes(message.action)) {
		forwardToContentScript(message);
		return;
	}

});
