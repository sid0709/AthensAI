// Messaging helpers for the Extension UI to communicate with the content script.
// Kept simple so UI components can import and send standardized messages.

export const commonTags = [
	"div", "a", "span", "img", "input", "button", "li", "h1", "h2", "p", "form", "section", "header", "footer", "textarea", "label"
];
export const commonProperties = [
	"id", "class", "name", "href", "src", "alt", "for", "type", "role", "aria-label", "data-testid"
];

/* global chrome */

function sendRuntimeMessage(message) {
	try {
		chrome.runtime.sendMessage(message, () => {
			// A tab can navigate or reload before the background receives the
			// command. Reading lastError prevents Chrome from reporting that
			// expected race as an unchecked extension error.
			void chrome.runtime.lastError;
		});
	} catch {
		// The extension context was invalidated while the page was reloading.
	}
}

export const highlightByPattern = (tag, property, pattern) => {
	if (!pattern) return;
	sendRuntimeMessage({
		action: "highlightByPattern",
		payload: {
			componentType: tag,
			propertyName: property,
			pattern: pattern,
		},
	});
};

export const handleHighlight = highlightByPattern;

export const clearHighlights = () => {
	sendRuntimeMessage({ action: "clearHighlight" });
};

export const handleClear = clearHighlights;

// Send an executeAction command to the content script. If `identifier` is provided
// and action === 'fetch', content script will echo back a `fetchResult` with same identifier.
export const executeAction = (tag, property, pattern, order, action, actionValue, fetchType, identifier) => {
	const payload = {
		componentType: tag,
		propertyName: property,
		pattern: pattern,
		order: parseInt(order, 10) || 0,
		action: action,
	};

	if (actionValue !== undefined && actionValue !== null) payload.value = actionValue;
	if (fetchType) payload.fetchType = fetchType;
	if (identifier) payload.identifier = identifier;

	sendRuntimeMessage({
		action: "executeAction",
		payload,
	});
};

export const handleAction = executeAction;

export const executeActionsSequence = (actions, runId) => {
	const payload = {
		runId: runId || null,
		actions: Array.isArray(actions) ? actions : [],
	};

	sendRuntimeMessage({
		action: "executeActionsSequence",
		payload,
	});
};

export const executeActionsParallel = (actions, runId) => {
	const payload = {
		runId: runId || null,
		actions: Array.isArray(actions) ? actions : [],
	};

	sendRuntimeMessage({
		action: "executeActionsParallel",
		payload,
	});
};

export const highlightInteractables = (runId) => {
	sendRuntimeMessage({
		action: 'highlightInteractables',
		payload: { runId }
	});
};
