/**
 * Capture-ready tab bookkeeping for tabCapture.
 * Only http(s) tabs where the user clicked the Lens icon may be captured.
 */

export function isCapturableTabUrl(url: string | undefined | null): boolean {
  return /^https?:/i.test(url || "");
}

export type CaptureReadyState = {
  tabIds: number[];
  lastInvokedTabId: number | null;
};

export function createCaptureReadyTracker() {
  const tabs = new Set<number>();
  let lastInvokedTabId: number | null = null;

    function remember(tabId: number, url?: string | null) {
    if (!Number.isInteger(tabId) || tabId < 0) return false;
    // Unknown URL: allow (caller should resolve via tabs.get when possible).
    // Known non-http URL: reject.
    if (url != null && String(url).length > 0 && !isCapturableTabUrl(url)) return false;
    tabs.add(tabId);
    lastInvokedTabId = tabId;
    return true;
  }

  function forget(tabId: number) {
    tabs.delete(tabId);
    if (lastInvokedTabId === tabId) lastInvokedTabId = null;
  }

  function has(tabId: number) {
    return tabs.has(tabId);
  }

  function resolve(preferredTabId?: number | null): number | null {
    const preferred = typeof preferredTabId === "number" && Number.isInteger(preferredTabId)
      ? preferredTabId
      : null;
    if (preferred != null && tabs.has(preferred)) return preferred;
    if (lastInvokedTabId != null && tabs.has(lastInvokedTabId)) return lastInvokedTabId;
    if (tabs.size === 1) return tabs.values().next().value ?? null;
    // Prefer any remaining ready tab (deterministic by ascending id).
    const sorted = [...tabs].sort((a, b) => a - b);
    return sorted[0] ?? null;
  }

  function snapshot(): CaptureReadyState {
    return {
      tabIds: [...tabs],
      lastInvokedTabId,
    };
  }

  function restore(state: CaptureReadyState | null | undefined) {
    tabs.clear();
    lastInvokedTabId = null;
    if (!state) return;
    for (const tabId of state.tabIds || []) {
      if (Number.isInteger(tabId) && tabId >= 0) tabs.add(tabId);
    }
    if (
      state.lastInvokedTabId != null
      && Number.isInteger(state.lastInvokedTabId)
      && tabs.has(state.lastInvokedTabId)
    ) {
      lastInvokedTabId = state.lastInvokedTabId;
    }
  }

  function size() {
    return tabs.size;
  }

  return {
    remember,
    forget,
    has,
    resolve,
    snapshot,
    restore,
    size,
  };
}
