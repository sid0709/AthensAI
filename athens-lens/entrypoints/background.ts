type StartRecordingMessage = {
  type: "ATHENS_LENS_START_RECORDING";
  sessionId: string;
  tabId: number;
  streamId: string;
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

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  if (preferredTabId != null) {
    try {
      const tab = await chrome.tabs.get(preferredTabId);
      if (tab?.id != null && /^https?:/i.test(tab.url || "")) return tab.id;
    } catch {
      // Fall through to the focused browser tab.
    }
  }

  const [focused] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (focused?.id != null && /^https?:/i.test(focused.url || "")) return focused.id;

  const tabs = await chrome.tabs.query({ lastFocusedWindow: true });
  const httpTab = tabs.find((tab) => tab.id != null && /^https?:/i.test(tab.url || ""));
  if (httpTab?.id != null) return httpTab.id;
  throw new Error("Open the application page in a browser tab, then try Ask AI again.");
}

export default defineBackground(() => {
  browser.action.onClicked.addListener((tab) => {
    if (tab.windowId === undefined) return;
    browser.sidePanel.open({ windowId: tab.windowId }).catch((error: unknown) => {
      console.error("Unable to open the Athens Lens side panel", error);
    });
  });

  chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
    if (message?.type === "ATHENS_LENS_START_RECORDING") {
      void (async () => {
        if (!message.streamId || message.tabId == null) {
          sendResponse({ ok: false, error: "Missing tab capture stream." });
          return;
        }
        await ensureOffscreenDocument();
        const response = await sendOffscreenMessage({
          type: "OFFSCREEN_START_RECORDING",
          sessionId: message.sessionId,
          streamId: message.streamId,
        });
        if (!response?.ok) {
          sendResponse({
            ok: false,
            tabId: message.tabId,
            error: response?.error || "Could not start the recorder.",
          });
          return;
        }
        recordingTabs.set(message.sessionId, message.tabId);
        sendResponse({ ok: true, tabId: message.tabId });
      })().catch((error: unknown) => {
        sendResponse({
          ok: false,
          tabId: message.tabId,
          error: error instanceof Error ? error.message : "Could not start recording.",
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
