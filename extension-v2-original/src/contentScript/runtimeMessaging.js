/* global chrome */

let contextInvalidated = false;

export function isExtensionContextValid() {
	if (contextInvalidated) return false;
	try {
		return Boolean(chrome?.runtime?.id);
	} catch {
		contextInvalidated = true;
		return false;
	}
}

function isContextInvalidatedError(err) {
	const message = String(err?.message || err || '');
	return /extension context invalidated|context invalidated/i.test(message);
}

export function safeRuntimeSendMessage(message) {
	if (!isExtensionContextValid()) return;

	try {
		const result = chrome.runtime.sendMessage(message);
		if (result && typeof result.catch === 'function') {
			result.catch((err) => {
				if (isContextInvalidatedError(err)) {
					contextInvalidated = true;
					return;
				}
				console.error('runtime.sendMessage failed', err);
			});
		}
	} catch (err) {
		if (isContextInvalidatedError(err)) {
			contextInvalidated = true;
			return;
		}
		console.error('runtime.sendMessage failed', err);
	}
}
