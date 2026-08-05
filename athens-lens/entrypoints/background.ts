import { stripStylesheetNoise } from "../src/recording/pageTextSanitize";

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

type RecordingDigestMessage = {
  type: "ATHENS_LENS_RECORDING_DIGEST";
  sessionId: string;
};

type PutRecordingMessage = {
  type: "ATHENS_LENS_PUT_RECORDING";
  sessionId: string;
  uploadUrl: string;
};

type DiscardRecordingMessage = {
  type: "ATHENS_LENS_DISCARD_RECORDING";
  sessionId: string;
};

type RuntimeMessage =
  | StartRecordingMessage
  | StopRecordingMessage
  | ReadPageTextMessage
  | RecordingDigestMessage
  | PutRecordingMessage
  | DiscardRecordingMessage;

type PageTextFrame = {
  url: string;
  title: string;
  metaDescription: string;
  visibleText: string;
  forms: Array<{
    label?: string;
    name?: string;
    type?: string;
    placeholder?: string;
    required?: boolean;
    options?: string[];
  }>;
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

const MAX_VISIBLE_TEXT_CHARS = 60_000;

function listTabFrames(tabId: number): Promise<Array<{ frameId: number; url?: string }>> {
  return new Promise((resolve) => {
    if (!chrome.webNavigation?.getAllFrames) {
      resolve([{ frameId: 0 }]);
      return;
    }
    chrome.webNavigation.getAllFrames({ tabId }, (frames) => {
      if (chrome.runtime.lastError?.message || !frames?.length) {
        resolve([{ frameId: 0 }]);
        return;
      }
      resolve(
        frames
          .filter((frame) => {
            const url = String(frame.url || "");
            if (!url || url === "about:blank") return frame.frameId === 0;
            if (/^(chrome|chrome-extension|devtools|data):/i.test(url)) return false;
            return true;
          })
          .map((frame) => ({ frameId: frame.frameId, url: frame.url })),
      );
    });
  });
}

/**
 * Runs inside each page frame. Visible text only (`innerText`) — never textContent/DOM dumps.
 * Must be self-contained and never throw.
 *
 * Also walks open Shadow DOM. Sites like Manatal careers-page mount the whole
 * application form into `#application-root.attachShadow({mode:"open"})`, and
 * `document.body.innerText` does not include shadow-root text.
 */
function extractFrameContent() {
  type Root = Document | ShadowRoot;

  const listOpenShadowRoots = (root: Root): ShadowRoot[] => {
    const found: ShadowRoot[] = [];
    const scope: ParentNode = root instanceof Document
      ? (root.body || root.documentElement || root)
      : root;
    if (!scope?.querySelectorAll) return found;
    for (const el of Array.from(scope.querySelectorAll("*"))) {
      const shadow = (el as Element).shadowRoot;
      if (!shadow) continue;
      found.push(shadow);
      found.push(...listOpenShadowRoots(shadow));
    }
    return found;
  };

  const fieldFromElement = (
    el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
    root: Root,
  ) => {
    try {
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") return null;
    } catch {
      // ignore
    }
    let label = "";
    try {
      if (el.id) {
        const safeId = el.id.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        const labeled = root.querySelector(`label[for="${safeId}"]`) as HTMLElement | null;
        label = labeled?.innerText || "";
      }
      if (!label) label = (el.closest("label") as HTMLElement | null)?.innerText || "";
      if (!label) label = el.getAttribute("aria-label") || "";
    } catch {
      label = el.getAttribute("aria-label") || "";
    }
    const options = el instanceof HTMLSelectElement
      ? Array.from(el.options)
        .map((option) => (option.innerText || option.textContent || "").trim())
        .filter(Boolean)
        .slice(0, 30)
      : [];
    return {
      label: label.replace(/\s+/g, " ").trim().slice(0, 200) || undefined,
      name: el.getAttribute("name") || undefined,
      type: el.getAttribute("type") || el.tagName.toLowerCase(),
      placeholder: el.getAttribute("placeholder") || undefined,
      required: el.hasAttribute("required") || el.getAttribute("aria-required") === "true",
      options: options.length ? options : undefined,
    };
  };

  const collectForms = () => {
    try {
      const roots: Root[] = [document, ...listOpenShadowRoots(document)];
      const fields: Array<NonNullable<ReturnType<typeof fieldFromElement>>> = [];
      for (const root of roots) {
        const nodes = root.querySelectorAll(
          "input, textarea, select, [role='textbox'], [contenteditable='true']",
        );
        for (const element of Array.from(nodes)) {
          if (fields.length >= 120) break;
          const mapped = fieldFromElement(
            element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
            root,
          );
          if (mapped && (mapped.label || mapped.name || mapped.placeholder)) {
            fields.push(mapped);
          }
        }
        if (fields.length >= 120) break;
      }
      return fields;
    } catch {
      return [];
    }
  };

  const isNonContentTag = (tag: string) =>
    tag === "STYLE"
    || tag === "SCRIPT"
    || tag === "NOSCRIPT"
    || tag === "TEMPLATE"
    || tag === "LINK"
    || tag === "META"
    || tag === "HEAD";

  const shadowInnerText = (shadow: ShadowRoot) => {
    const parts: string[] = [];
    for (const node of Array.from(shadow.childNodes)) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement;
        // <style>.innerText returns the stylesheet (browser special-case) — skip it.
        if (isNonContentTag(el.tagName)) continue;
        const text = (el.innerText || "").trim();
        if (text) parts.push(text);
      } else if (node.nodeType === Node.TEXT_NODE) {
        const text = (node.textContent || "").replace(/\s+/g, " ").trim();
        if (text) parts.push(text);
      }
    }
    // Fallback: labels/headings if children produced nothing (odd hosts).
    if (!parts.length) {
      for (const el of Array.from(shadow.querySelectorAll("label, legend, h1, h2, h3, h4, p, li, button"))) {
        if (isNonContentTag(el.tagName) || el.closest("style, script, noscript, template")) continue;
        const text = ((el as HTMLElement).innerText || "").replace(/\s+/g, " ").trim();
        if (text) parts.push(text);
      }
    }
    return parts.join("\n\n").trim();
  };

  const collectVisibleText = () => {
    const parts: string[] = [];
    const light = (document.body?.innerText || document.documentElement?.innerText || "").trim();
    if (light) parts.push(light);

    for (const shadow of listOpenShadowRoots(document)) {
      const shadowText = shadowInnerText(shadow);
      if (shadowText) parts.push(shadowText);
    }

    return parts.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
  };

  try {
    return {
      url: location.href,
      title: document.title || "",
      metaDescription:
        document.querySelector('meta[name="description"]')?.getAttribute("content") || "",
      visibleText: collectVisibleText(),
      forms: collectForms(),
    };
  } catch {
    return {
      url: location.href,
      title: document.title || "",
      metaDescription: "",
      visibleText: "",
      forms: [],
    };
  }
}

async function readFrameContent(tabId: number, frameId: number): Promise<PageTextFrame | null> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      func: extractFrameContent,
    });
    return results?.[0]?.result || null;
  } catch {
    return null;
  }
}

function fingerprintText(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();
  return normalized.slice(0, 400);
}

function mergeVisibleFrameText(frames: PageTextFrame[], maxChars = MAX_VISIBLE_TEXT_CHARS) {
  const ranked = [...frames]
    .map((frame) => ({
      ...frame,
      visibleText: stripStylesheetNoise(frame.visibleText).trim(),
    }))
    .filter((frame) => frame.visibleText.length > 0)
    .sort((a, b) => b.visibleText.length - a.visibleText.length);

  const selected: PageTextFrame[] = [];
  const seen = new Set<string>();
  let total = 0;

  for (const frame of ranked) {
    if (total >= maxChars) break;
    const key = fingerprintText(frame.visibleText);
    if (seen.has(key)) continue;
    // Skip near-duplicates contained in an already-selected larger frame.
    if ([...seen].some((existing) => existing.includes(key.slice(0, 160)) || key.includes(existing.slice(0, 160)))) {
      continue;
    }
    const room = maxChars - total;
    const sliced = frame.visibleText.slice(0, room);
    if (!sliced) continue;
    seen.add(key);
    selected.push({ ...frame, visibleText: sliced });
    total += sliced.length;
  }

  // Always keep a truncated slice of the largest frame when nothing else survived.
  if (!selected.length && ranked[0]) {
    const frame = ranked[0];
    return {
      frames: [{ ...frame, visibleText: frame.visibleText.slice(0, maxChars) }],
      visibleText: frame.visibleText.slice(0, maxChars),
    };
  }

  const visibleText = selected
    .map((frame, index) => {
      const header = selected.length > 1
        ? `[frame ${index + 1}${frame.url ? ` · ${frame.url}` : ""}]\n`
        : "";
      return `${header}${frame.visibleText}`;
    })
    .join("\n\n")
    .slice(0, maxChars);

  return { frames: selected, visibleText };
}

function formsAsVisibleText(
  forms: PageTextFrame["forms"],
): string {
  return forms
    .map((field) => {
      const bits = [
        field.label,
        field.name ? `(${field.name})` : "",
        field.type ? `[${field.type}]` : "",
        field.placeholder ? `placeholder: ${field.placeholder}` : "",
        field.required ? "required" : "",
        field.options?.length ? `options: ${field.options.join(" | ")}` : "",
      ].filter(Boolean);
      return bits.join(" · ");
    })
    .filter(Boolean)
    .join("\n");
}

async function readTabPageText(tabId: number) {
  const frameList = await listTabFrames(tabId);
  const frameResults: PageTextFrame[] = [];

  for (const frame of frameList) {
    const result = await readFrameContent(tabId, frame.frameId);
    if (!result) continue;
    if (frame.url && !result.url) result.url = frame.url;
    if (result.visibleText?.trim() || result.forms?.length) frameResults.push(result);
  }

  if (!frameResults.length) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: extractFrameContent,
      });
      for (const entry of results || []) {
        if (entry?.result?.visibleText?.trim() || entry?.result?.forms?.length) {
          frameResults.push(entry.result);
        }
      }
    } catch {
      // Fall through to empty context below.
    }
  }

  // Retry once in the page's main world — some hosts expose open shadow only there.
  if (!frameResults.some((frame) => frame.visibleText?.trim())) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        world: "MAIN",
        func: extractFrameContent,
      });
      for (const entry of results || []) {
        if (entry?.result?.visibleText?.trim() || entry?.result?.forms?.length) {
          frameResults.push(entry.result);
        }
      }
    } catch {
      // Keep whatever we already have.
    }
  }

  let tabUrl = "";
  try {
    tabUrl = String((await tabsGet(tabId)).url || "");
  } catch {
    tabUrl = "";
  }

  if (!frameResults.length) {
    // Still return a context so the Ask AI panel can show empty innerText for debugging.
    return {
      url: tabUrl,
      title: "",
      metaDescription: "",
      visibleText: "",
      forms: [],
      readMeta: {
        tabId,
        frameCount: 0,
        charCount: 0,
        formCount: 0,
        note: "executeScript returned no frames with text or form fields",
      },
    };
  }

  const { frames: selectedFrames, visibleText: mergedText } = mergeVisibleFrameText(frameResults);
  const allForms = (selectedFrames.length ? selectedFrames : frameResults)
    .flatMap((frame) => frame.forms || [])
    .slice(0, 120);

  let visibleText = stripStylesheetNoise(mergedText).trim();
  if (!visibleText && allForms.length) {
    visibleText = formsAsVisibleText(allForms).slice(0, MAX_VISIBLE_TEXT_CHARS);
  }
  visibleText = visibleText.slice(0, MAX_VISIBLE_TEXT_CHARS);

  const primary = selectedFrames[0] || frameResults[0]!;
  return {
    url: primary.url || tabUrl,
    title: primary.title,
    metaDescription: primary.metaDescription,
    visibleText,
    forms: allForms,
    readMeta: {
      tabId,
      frameCount: frameResults.length,
      selectedFrameCount: selectedFrames.length,
      charCount: visibleText.length,
      formCount: allForms.length,
      truncated: frameResults.some((frame) => frame.visibleText.length > MAX_VISIBLE_TEXT_CHARS),
    },
  };
}

async function resolveReadableTabId(preferredTabId?: number | null) {
  const preferred = asTabId(preferredTabId) ?? invokedTabId;

  // Prefer the recording / invoked application tab when available — side panel
  // clicks can make "focused" resolution flaky.
  if (preferred != null) {
    try {
      const tab = await tabsGet(preferred);
      if (tab?.id != null && isCapturableUrl(tab.url)) return tab.id;
    } catch {
      // Fall through.
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

    if (message?.type === "ATHENS_LENS_RECORDING_DIGEST") {
      void (async () => {
        await ensureOffscreenDocument();
        const response = await sendOffscreenMessage({
          type: "OFFSCREEN_RECORDING_DIGEST",
          sessionId: message.sessionId,
        });
        if (!response?.ok) {
          sendResponse({ ok: false, error: response?.error || "Could not read recording." });
          return;
        }
        sendResponse({
          ok: true,
          mimeType: response.mimeType,
          byteLength: response.byteLength,
          filename: response.filename,
        });
      })().catch((error: unknown) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Could not read recording.",
        });
      });
      return true;
    }

    if (message?.type === "ATHENS_LENS_PUT_RECORDING") {
      void (async () => {
        await ensureOffscreenDocument();
        const response = await sendOffscreenMessage({
          type: "OFFSCREEN_PUT_RECORDING",
          sessionId: message.sessionId,
          uploadUrl: message.uploadUrl,
        });
        if (!response?.ok) {
          sendResponse({ ok: false, error: response?.error || "Could not upload recording." });
          return;
        }
        sendResponse({ ok: true });
      })().catch((error: unknown) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Could not upload recording.",
        });
      });
      return true;
    }

    if (message?.type === "ATHENS_LENS_DISCARD_RECORDING") {
      void (async () => {
        await ensureOffscreenDocument();
        await sendOffscreenMessage({
          type: "OFFSCREEN_DISCARD_RECORDING",
          sessionId: message.sessionId,
        });
        sendResponse({ ok: true });
      })().catch(() => sendResponse({ ok: true }));
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
