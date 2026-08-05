type StartRecordingMessage = {
  type: "ATHENS_LENS_START_RECORDING";
  sessionId: string;
  applyUrl: string;
};

type StopRecordingMessage = {
  type: "ATHENS_LENS_STOP_RECORDING";
  sessionId: string;
};

type ReadPageTextMessage = {
  type: "ATHENS_LENS_READ_PAGE_TEXT";
  tabId?: number | null;
};

type RuntimeMessage = StartRecordingMessage | StopRecordingMessage | ReadPageTextMessage;

type PageTextFrame = {
  url: string;
  title: string;
  metaDescription: string;
  visibleText: string;
};

const recordingTabs = new Map<string, number>();

/**
 * tabCapture only works for the tab where the user invoked the extension
 * (activeTab). Newly created tabs cannot be captured. We capture this tab,
 * then navigate it to the apply URL — capture continues across navigations.
 */
let invokedTabId: number | null = null;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isCapturableUrl(url: string | undefined | null) {
  return /^https?:/i.test(url || "");
}

function asTabId(value: unknown): number | null {
  const tabId = typeof value === "number" ? value : Number(value);
  return Number.isInteger(tabId) && tabId >= 0 ? tabId : null;
}

function tabsGet(tabId: number): Promise<chrome.tabs.Tab> {
  return new Promise((resolve, reject) => {
    chrome.tabs.get(tabId, (tab) => {
      const error = chrome.runtime.lastError?.message;
      if (error || !tab) {
        reject(new Error(error || "Tab not found."));
        return;
      }
      resolve(tab);
    });
  });
}

function tabsQuery(queryInfo: {
  active?: boolean;
  lastFocusedWindow?: boolean;
}): Promise<chrome.tabs.Tab[]> {
  return new Promise((resolve, reject) => {
    chrome.tabs.query(queryInfo, (tabs) => {
      const error = chrome.runtime.lastError?.message;
      if (error) {
        reject(new Error(error));
        return;
      }
      resolve(tabs || []);
    });
  });
}

function tabsUpdate(tabId: number, url: string): Promise<chrome.tabs.Tab> {
  return new Promise((resolve, reject) => {
    chrome.tabs.update(tabId, { url, active: true }, (tab) => {
      const error = chrome.runtime.lastError?.message;
      if (error || !tab) {
        reject(new Error(error || "Could not open the application page."));
        return;
      }
      resolve(tab);
    });
  });
}

function rememberInvokedTab(tabId: number | undefined | null) {
  const id = asTabId(tabId);
  if (id != null) invokedTabId = id;
}

function getMediaStreamIdSync(
  tabId: number,
  callback: (result: { streamId?: string; error?: string }) => void,
) {
  chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId) => {
    const error = chrome.runtime.lastError?.message;
    if (error || !streamId) {
      callback({ error: error || "Could not capture the application tab." });
      return;
    }
    callback({ streamId });
  });
}

async function ensureOffscreenDocument() {
  const hasDocument = await chrome.offscreen.hasDocument?.();
  if (hasDocument) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: [chrome.offscreen.Reason.USER_MEDIA],
    justification: "Record the application tab while bidding from Athens Lens.",
  });
}

async function sendOffscreenMessage(message: Record<string, unknown>, attempts = 12) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await chrome.runtime.sendMessage(message);
      if (response) return response;
    } catch (error) {
      lastError = error;
    }
    await delay(40 + attempt * 20);
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Recorder failed to start. Reload Athens Lens and try again.");
}

async function beginOffscreenRecording(
  sessionId: string,
  tabId: number,
  streamId: string,
  applyUrl: string,
) {
  await ensureOffscreenDocument();
  const response = await sendOffscreenMessage({
    type: "OFFSCREEN_START_RECORDING",
    sessionId,
    streamId,
  });
  if (!response?.ok) {
    throw new Error(response?.error || "Could not start the recorder.");
  }
  recordingTabs.set(sessionId, tabId);
  await tabsUpdate(tabId, applyUrl);
  return tabId;
}

async function readTabPageText(tabId: number) {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: () => {
      const body = document.body;
      return {
        url: location.href,
        title: document.title || "",
        metaDescription:
          document.querySelector('meta[name="description"]')?.getAttribute("content") || "",
        visibleText: body?.innerText || "",
      };
    },
  });

  const frames = (results || [])
    .map((entry: { result?: PageTextFrame }) => entry.result)
    .filter((entry): entry is PageTextFrame => Boolean(entry?.visibleText || entry?.title || entry?.url));

  if (!frames.length) {
    throw new Error("Could not read text from the open page.");
  }

  const primary = frames[0]!;
  const visibleText = frames
    .map((frame) => frame.visibleText.trim())
    .filter(Boolean)
    .join("\n\n");

  return {
    url: primary.url,
    title: primary.title,
    metaDescription: primary.metaDescription,
    visibleText,
  };
}

async function resolveReadableTabId(preferredTabId?: number | null) {
  const preferred = asTabId(preferredTabId) ?? invokedTabId;
  if (preferred != null) {
    try {
      const tab = await tabsGet(preferred);
      if (tab?.id != null && isCapturableUrl(tab.url)) return tab.id;
    } catch {
      // Fall through to the focused browser tab.
    }
  }

  const [focused] = await tabsQuery({ active: true, lastFocusedWindow: true });
  if (focused?.id != null && isCapturableUrl(focused.url)) return focused.id;

  const tabs = await tabsQuery({ lastFocusedWindow: true });
  const httpTab = tabs.find((tab) => tab.id != null && isCapturableUrl(tab.url));
  if (httpTab?.id != null) return httpTab.id;
  throw new Error("Open the application page in a browser tab, then try Ask AI again.");
}

export default defineBackground(() => {
  browser.action.onClicked.addListener((tab) => {
    rememberInvokedTab(tab.id);
    if (tab.windowId === undefined) return;
    browser.sidePanel.open({ windowId: tab.windowId }).catch((error: unknown) => {
      console.error("Unable to open the Athens Lens side panel", error);
    });
  });

  chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
    if (message?.type === "ATHENS_LENS_START_RECORDING") {
      const tabId = invokedTabId;
      if (tabId == null) {
        sendResponse({
          ok: false,
          error: "Click the Athens Lens icon on a normal web page, then try Apply & record again.",
        });
        return false;
      }

      // getMediaStreamId must run in this turn (no awaits before it) or Chrome
      // rejects with the activeTab / "Chrome pages cannot be captured" error.
      getMediaStreamIdSync(tabId, (capture) => {
        if (!capture.streamId) {
          sendResponse({
            ok: false,
            tabId,
            error: capture.error
              || "Click the Athens Lens icon on this tab, then try Apply & record again.",
          });
          return;
        }

        void beginOffscreenRecording(
          message.sessionId,
          tabId,
          capture.streamId,
          message.applyUrl,
        )
          .then((recordedTabId) => sendResponse({ ok: true, tabId: recordedTabId }))
          .catch((error: unknown) => {
            sendResponse({
              ok: false,
              tabId,
              error: error instanceof Error ? error.message : "Could not start recording.",
            });
          });
      });
      return true;
    }

    if (message?.type === "ATHENS_LENS_STOP_RECORDING") {
      void (async () => {
        await ensureOffscreenDocument();
        const response = await sendOffscreenMessage({
          type: "OFFSCREEN_STOP_RECORDING",
          sessionId: message.sessionId,
        });
        const tabId = recordingTabs.get(message.sessionId) ?? null;
        recordingTabs.delete(message.sessionId);
        if (!response?.ok) {
          sendResponse({ ok: false, tabId, error: response?.error || "Could not stop recording." });
          return;
        }
        sendResponse({
          ok: true,
          tabId,
          mimeType: response.mimeType,
          byteLength: response.byteLength,
          filename: response.filename,
        });
      })().catch((error: unknown) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Could not stop recording.",
        });
      });
      return true;
    }

    if (message?.type === "ATHENS_LENS_READ_PAGE_TEXT") {
      void (async () => {
        const tabId = await resolveReadableTabId(message.tabId);
        const pageContext = await readTabPageText(tabId);
        sendResponse({ ok: true, tabId, pageContext });
      })().catch((error: unknown) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Could not read the open page.",
        });
      });
      return true;
    }

    return false;
  });
});
