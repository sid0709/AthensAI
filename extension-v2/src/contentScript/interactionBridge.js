// Messaging helpers for the Extension UI to communicate with the content script.
// Kept simple so UI components can import and send standardized messages.

export const commonTags = [
	"div", "a", "span", "img", "input", "button", "li", "h1", "h2", "p", "form", "section", "header", "footer", "textarea", "label"
];
export const commonProperties = [
	"id", "class", "name", "href", "src", "alt", "for", "type", "role", "aria-label", "data-testid"
];

/* global chrome */

export const highlightByPattern = (tag, property, pattern) => {
	if (!pattern) return;
	chrome.runtime.sendMessage({
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
	chrome.runtime.sendMessage({ action: "clearHighlight" });
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

	chrome.runtime.sendMessage({
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

	chrome.runtime.sendMessage({
		action: "executeActionsSequence",
		payload,
	});
};

export const executeActionsParallel = (actions, runId) => {
	const payload = {
		runId: runId || null,
		actions: Array.isArray(actions) ? actions : [],
	};

	chrome.runtime.sendMessage({
		action: "executeActionsParallel",
		payload,
	});
};

export const highlightInteractables = (runId) => {
	chrome.runtime.sendMessage({
		action: 'highlightInteractables',
		payload: { runId }
	});
};

