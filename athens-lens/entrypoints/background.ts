import { stripStylesheetNoise } from "../src/recording/pageTextSanitize";
import { createCaptureReadyTracker } from "../src/recording/captureReadyTabs";
import {
  injectSerializePage,
  MAX_FORM_TREE_CHARS,
  isNoiseFrameUrl,
  type OakInjectSerializeResult,
} from "../src/oak-forms";
import {
  armResumeSessionOnTab,
  disarmResumeSessionOnTab,
  flushResumeAuditOutbox,
  persistResumeAuditFromOutbox,
  type ResumeSessionArmPayload,
} from "../src/recording/resume/resumeAuditPersist";
import type { RenameAuditPayload } from "../src/recording/resume/resumeFileTracking";
import { RESUME_AUDIT_OUTBOX_PREFIX } from "../src/recording/resume/resumeFileTracking";

type JobSnapshot = {
  id: string;
  title: string;
  company: string;
  applyUrl: string;
  companyLogoUrl?: string;
  location?: string;
  workMode?: string;
  employmentType?: string;
  seniority?: string;
  salary?: string;
  experience?: string;
  postedAt?: string;
  skills?: readonly string[];
  tags?: readonly string[];
  applicantsText?: string;
  description?: string;
  responsibilities?: readonly string[];
  qualifications?: readonly string[];
};

type StartRecordingMessage = {
  type: "ATHENS_LENS_START_RECORDING";
  sessionId: string;
  applyUrl: string;
  /** Pre-captured from the side panel click turn (open new tab → getMediaStreamId). */
  tabId?: number | null;
  streamId?: string | null;
  preferredTabId?: number | null;
  job?: JobSnapshot | null;
  expectedResumeName?: string | null;
  resumeSetFolder?: string | null;
  bidderName?: string | null;
};

type StopRecordingMessage = {
  type: "ATHENS_LENS_STOP_RECORDING";
  sessionId: string;
};

type ListSessionsMessage = {
  type: "ATHENS_LENS_LIST_SESSIONS";
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

type ResumeSelectedMessage = {
  type: "ATHENS_LENS_RESUME_SELECTED";
  payload: RenameAuditPayload;
  outboxKey?: string;
};

type GetResumeSessionMessage = {
  type: "ATHENS_LENS_GET_RESUME_SESSION";
};

type ShowToastMessage = {
  type: "ATHENS_LENS_SHOW_TOAST";
  message: string;
};

/** Side panel queued a Record; toolbar icon click supplies the capture gesture. */
type PendingRecordMessage = {
  type: "ATHENS_LENS_PENDING_RECORD";
  sessionId: string;
  applyUrl: string;
  tabId: number;
  job?: JobSnapshot | null;
  expectedResumeName?: string | null;
  resumeSetFolder?: string | null;
  bidderName?: string | null;
};

type RuntimeMessage =
  | StartRecordingMessage
  | StopRecordingMessage
  | ListSessionsMessage
  | ReadPageTextMessage
  | RecordingDigestMessage
  | PutRecordingMessage
  | DiscardRecordingMessage
  | ResumeSelectedMessage
  | GetResumeSessionMessage
  | ShowToastMessage
  | PendingRecordMessage;

type LiveRecordingSession = {
  sessionId: string;
  tabId: number;
  job: JobSnapshot | null;
  expectedResumeName: string;
  resumeSetFolder: string;
  startedAt: number;
};

type PendingRecord = {
  sessionId: string;
  tabId: number;
  applyUrl: string;
  job: JobSnapshot | null;
  expectedResumeName: string;
  resumeSetFolder: string;
};

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
const liveSessions = new Map<string, LiveRecordingSession>();
const captureReady = createCaptureReadyTracker();
/** Queued when side-panel Record cannot capture (needs toolbar gesture). */
let pendingRecord: PendingRecord | null = null;
const CAPTURE_READY_STORAGE_KEY = "athensLensCaptureReadyTabs";

function isActiveTabCaptureError(message: string | undefined | null) {
  return /activeTab|invoked for the current page|Chrome pages cannot be captured/i.test(
    message || "",
  );
}

function notifyRecordingStarted(session: LiveRecordingSession) {
  void chrome.runtime.sendMessage({
    type: "ATHENS_LENS_RECORDING_STARTED",
    sessionId: session.sessionId,
    tabId: session.tabId,
    job: session.job,
    startedAt: session.startedAt,
  }).catch(() => undefined);
}

/**
 * tabCapture only works for tabs where the user invoked the extension
 * (activeTab) on a normal http(s) page. Persist ready tab ids so a service
 * worker restart does not wipe them mid-session.
 */

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
  currentWindow?: boolean;
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

function persistCaptureReady() {
  const snapshot = captureReady.snapshot();
  try {
    void chrome.storage.session?.set?.({ [CAPTURE_READY_STORAGE_KEY]: snapshot });
  } catch {
    void chrome.storage.local.set({ [CAPTURE_READY_STORAGE_KEY]: snapshot });
  }
}

function restoreCaptureReady() {
  const apply = (items: Record<string, unknown>) => {
    const snapshot = items[CAPTURE_READY_STORAGE_KEY] as {
      tabIds?: number[];
      lastInvokedTabId?: number | null;
    } | undefined;
    if (!snapshot) return;
    captureReady.restore({
      tabIds: Array.isArray(snapshot.tabIds) ? snapshot.tabIds : [],
      lastInvokedTabId: snapshot.lastInvokedTabId ?? null,
    });
  };
  try {
    if (chrome.storage.session?.get) {
      void chrome.storage.session.get(CAPTURE_READY_STORAGE_KEY).then(apply);
      return;
    }
  } catch {
    // Fall through to local.
  }
  void chrome.storage.local.get(CAPTURE_READY_STORAGE_KEY).then(apply);
}

function rememberInvokedTab(tab: { id?: number; url?: string } | number | undefined | null) {
  if (tab == null) return;
  if (typeof tab === "number") {
    // Legacy path without URL — do not mark capture-ready without proving http(s).
    return;
  }
  const id = asTabId(tab.id);
  if (id == null) return;
  if (captureReady.remember(id, tab.url)) {
    persistCaptureReady();
  }
}

async function rememberInvokedTabFromAction(tab: { id?: number; url?: string; windowId?: number }) {
  let url = tab.url;
  const id = asTabId(tab.id);
  // action.onClicked sometimes omits url; resolve before deciding capture-ready.
  if (id != null && !isCapturableUrl(url)) {
    try {
      const fresh = await tabsGet(id);
      url = fresh.url;
    } catch {
      // Keep original.
    }
  }
  rememberInvokedTab({ id: tab.id, url });
}

function sessionIdForTab(tabId: number): string | null {
  for (const [sessionId, recordedTabId] of recordingTabs) {
    if (recordedTabId === tabId) return sessionId;
  }
  return null;
}

function resolveCaptureTabId(preferredTabId?: number | null): number | null {
  return captureReady.resolve(preferredTabId);
}

function forgetTab(tabId: number) {
  captureReady.forget(tabId);
  persistCaptureReady();
  const sessionId = sessionIdForTab(tabId);
  if (sessionId) {
    recordingTabs.delete(sessionId);
    liveSessions.delete(sessionId);
  }
  void disarmResumeSessionOnTab(tabId).catch(() => undefined);
}

function listLiveSessions(): LiveRecordingSession[] {
  return Array.from(liveSessions.values());
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
  options?: { navigate?: boolean },
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
  // Side panel already opened the tab at applyUrl — skip a second navigation.
  if (options?.navigate !== false) {
    await tabsUpdate(tabId, applyUrl);
  }
  return tabId;
}

function finishStartRecording(
  message: StartRecordingMessage,
  tabId: number,
  streamId: string,
  options: { navigate: boolean },
  sendResponse: (response: unknown) => void,
) {
  void beginOffscreenRecording(
    message.sessionId,
    tabId,
    streamId,
    message.applyUrl,
    { navigate: options.navigate },
  )
    .then(async (recordedTabId) => {
      captureReady.remember(recordedTabId, message.applyUrl);
      persistCaptureReady();
      rememberLiveSession(
        message.sessionId,
        recordedTabId,
        message.job,
        message.expectedResumeName,
        message.resumeSetFolder,
      );
      const live = liveSessions.get(message.sessionId);
      if (live) {
        await armLiveSession(live);
      }
      sendResponse({ ok: true, tabId: recordedTabId });
    })
    .catch((error: unknown) => {
      sendResponse({
        ok: false,
        tabId,
        error: error instanceof Error ? error.message : "Could not start recording.",
      });
    });
}

function rememberLiveSession(
  sessionId: string,
  tabId: number,
  job: JobSnapshot | null | undefined,
  expectedResumeName?: string | null,
  resumeSetFolder?: string | null,
) {
  liveSessions.set(sessionId, {
    sessionId,
    tabId,
    job: job ?? null,
    expectedResumeName: String(expectedResumeName || "").trim(),
    resumeSetFolder: String(resumeSetFolder || "").trim(),
    startedAt: Date.now(),
  });
}

function liveSessionForTab(tabId: number): LiveRecordingSession | null {
  for (const session of liveSessions.values()) {
    if (session.tabId === tabId) return session;
  }
  return null;
}

function toArmPayload(session: LiveRecordingSession): ResumeSessionArmPayload {
  return {
    isRecording: true,
    sessionId: session.sessionId,
    jobId: session.job?.id || "",
    expectedResumeName: session.expectedResumeName,
    resumeSetFolder: session.resumeSetFolder,
    companyName: session.job?.company || "",
    jobTitle: session.job?.title || "",
  };
}

async function armLiveSession(session: LiveRecordingSession) {
  if (!session.expectedResumeName && !session.resumeSetFolder) return;
  await armResumeSessionOnTab(session.tabId, toArmPayload(session));
}

function notifySidePanelResumeAudit(
  payload: RenameAuditPayload,
  tabId: number | null,
) {
  const originalName = String(payload.originalName || payload.originalFileName || "").trim();
  if (!originalName) return;
  try {
    void chrome.runtime.sendMessage({
      type: "ATHENS_LENS_RESUME_AUDIT",
      tabId,
      sessionId: payload.sessionId || null,
      jobId: payload.jobId || null,
      originalName,
      cleanedName: String(payload.cleanedName || payload.submittedFileName || "").trim() || null,
      expectedName: String(payload.expectedName || "").trim() || null,
      renamed: Boolean(payload.renamed),
    });
  } catch {
    // Side panel may be closed.
  }
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

async function readFrameOakFormTree(
  tabId: number,
  frameId: number,
): Promise<OakInjectSerializeResult | null> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      world: "MAIN",
      func: injectSerializePage,
    });
    return results?.[0]?.result || null;
  } catch {
    return null;
  }
}

function mergeOakFormTrees(
  frames: Array<OakInjectSerializeResult & { frameUrl?: string }>,
  maxChars = MAX_FORM_TREE_CHARS,
): { formTree: string; oakFrameCount: number; nodeCount: number; fieldCount: number } {
  const usable = frames.filter((frame) => {
    const url = frame.frameUrl || frame.url;
    if (isNoiseFrameUrl(url)) return false;
    return Boolean(String(frame.formTree || "").trim());
  });
  if (!usable.length) return { formTree: "", oakFrameCount: 0, nodeCount: 0, fieldCount: 0 };

  // Prefer the densest application frame first (usually the top page).
  usable.sort((a, b) => (Number(b.fieldCount) || 0) - (Number(a.fieldCount) || 0));

  const parts: string[] = [];
  let total = 0;
  let nodeCount = 0;
  let fieldCount = 0;

  for (let index = 0; index < usable.length; index += 1) {
    if (total >= maxChars) break;
    const frame = usable[index]!;
    nodeCount += Number(frame.nodeCount) || 0;
    fieldCount += Number(frame.fieldCount) || 0;
    const header = usable.length > 1
      ? `[frame ${index + 1}${frame.frameUrl || frame.url ? ` · ${frame.frameUrl || frame.url}` : ""}]\n`
      : "";
    const body = String(frame.formTree || "").trim();
    const chunk = `${header}${body}`.slice(0, maxChars - total);
    if (!chunk) continue;
    parts.push(chunk);
    total += chunk.length;
  }

  return {
    formTree: parts.join("\n\n").slice(0, maxChars),
    oakFrameCount: usable.length,
    nodeCount,
    fieldCount,
  };
}

async function readTabOakFormTree(tabId: number): Promise<{
  formTree: string;
  oakFrameCount: number;
  nodeCount: number;
  fieldCount: number;
  url: string;
  title: string;
}> {
  const frameList = await listTabFrames(tabId);
  const frameResults: Array<OakInjectSerializeResult & { frameUrl?: string }> = [];

  for (const frame of frameList) {
    if (isNoiseFrameUrl(frame.url)) continue;
    const result = await readFrameOakFormTree(tabId, frame.frameId);
    if (!result?.formTree?.trim()) continue;
    if (isNoiseFrameUrl(result.url)) continue;
    frameResults.push({ ...result, frameUrl: frame.url || result.url });
  }

  if (!frameResults.length) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        world: "MAIN",
        func: injectSerializePage,
      });
      for (const entry of results || []) {
        const result = entry?.result;
        if (!result?.formTree?.trim()) continue;
        if (isNoiseFrameUrl(result.url)) continue;
        frameResults.push(result);
      }
    } catch {
      // Keep empty.
    }
  }

  const merged = mergeOakFormTrees(frameResults);
  const primary = [...frameResults]
    .filter((frame) => !isNoiseFrameUrl(frame.frameUrl || frame.url))
    .sort((a, b) => (Number(b.fieldCount) || 0) - (Number(a.fieldCount) || 0))[0]
    || frameResults[0];
  return {
    ...merged,
    url: primary?.url || "",
    title: primary?.title || "",
  };
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

  const oak = await readTabOakFormTree(tabId);

  if (!frameResults.length && !oak.formTree) {
    // Still return a context so the Ask AI panel can show empty innerText for debugging.
    return {
      url: tabUrl,
      title: "",
      metaDescription: "",
      visibleText: "",
      formTree: "",
      forms: [],
      readMeta: {
        tabId,
        frameCount: 0,
        charCount: 0,
        formCount: 0,
        formTreeChars: 0,
        oakFrameCount: 0,
        oakNodeCount: 0,
        oakFieldCount: 0,
        note: "executeScript returned no frames with text, form fields, or Oak tree",
      },
    };
  }

  const { frames: selectedFrames, visibleText: mergedText } = frameResults.length
    ? mergeVisibleFrameText(frameResults)
    : { frames: [] as PageTextFrame[], visibleText: "" };
  const allForms = (selectedFrames.length ? selectedFrames : frameResults)
    .flatMap((frame) => frame.forms || [])
    .slice(0, 120);

  let visibleText = stripStylesheetNoise(mergedText).trim();
  if (!visibleText && allForms.length) {
    visibleText = formsAsVisibleText(allForms).slice(0, MAX_VISIBLE_TEXT_CHARS);
  }
  visibleText = visibleText.slice(0, MAX_VISIBLE_TEXT_CHARS);

  const primary = selectedFrames[0] || frameResults[0];
  return {
    url: primary?.url || oak.url || tabUrl,
    title: primary?.title || oak.title || "",
    metaDescription: primary?.metaDescription || "",
    visibleText,
    formTree: oak.formTree,
    forms: allForms,
    readMeta: {
      tabId,
      frameCount: frameResults.length,
      selectedFrameCount: selectedFrames.length,
      charCount: visibleText.length,
      formCount: allForms.length,
      formTreeChars: oak.formTree.length,
      oakFrameCount: oak.oakFrameCount,
      oakNodeCount: oak.nodeCount,
      oakFieldCount: oak.fieldCount,
      truncated: frameResults.some((frame) => frame.visibleText.length > MAX_VISIBLE_TEXT_CHARS)
        || oak.formTree.length >= MAX_FORM_TREE_CHARS,
    },
  };
}

async function resolveReadableTabId(preferredTabId?: number | null) {
  // Ask AI always targets the tab the user is looking at — not a prior
  // recording / toolbar-invoked tab (those often still point at a JD page).
  const [focused] = await tabsQuery({ active: true, lastFocusedWindow: true });
  if (focused?.id != null && isCapturableUrl(focused.url)) return focused.id;

  const preferred = asTabId(preferredTabId);
  if (preferred != null) {
    try {
      const tab = await tabsGet(preferred);
      if (tab?.id != null && isCapturableUrl(tab.url)) return tab.id;
    } catch {
      // Fall through.
    }
  }

  const tabs = await tabsQuery({ lastFocusedWindow: true });
  const httpTab = tabs.find((tab) => tab.id != null && isCapturableUrl(tab.url));
  if (httpTab?.id != null) return httpTab.id;
  throw new Error("Open the application page in a browser tab, then try Ask AI again.");
}

export default defineBackground(() => {
  restoreCaptureReady();

  // Chrome only grants tabCapture after the extension is invoked for the page
  // (toolbar icon). Side-panel Record alone is not enough — capture here when
  // a pending Record is waiting for this tab.
  browser.action.onClicked.addListener((tab) => {
    if (tab?.windowId != null) {
      browser.sidePanel.open({ windowId: tab.windowId }).catch((error: unknown) => {
        console.error("Unable to open the Athens Lens side panel", error);
      });
    }
    if (tab?.id == null) return;

    chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }, (streamId) => {
      const captureError = chrome.runtime.lastError?.message;
      void handleLensActionClick(tab, captureError ? null : (streamId || null));
    });
  });

  async function handleLensActionClick(
    tab: { id?: number; url?: string; windowId?: number },
    streamId: string | null,
  ) {
    await rememberInvokedTabFromAction(tab);
    const tabId = asTabId(tab.id);
    if (tabId == null) return;

    if (sessionIdForTab(tabId)) {
      // Already recording — panel is open for Complete / Ask AI.
      return;
    }

    const pending = pendingRecord && pendingRecord.tabId === tabId ? pendingRecord : null;
    if (!pending || !streamId) {
      if (pending && !streamId) {
        void chrome.runtime.sendMessage({
          type: "ATHENS_LENS_PENDING_RECORD_FAILED",
          tabId,
          error: "Could not capture this tab. Stay on the application page and click the Athens Lens icon again.",
        }).catch(() => undefined);
      }
      return;
    }

    pendingRecord = null;
    try {
      await beginOffscreenRecording(
        pending.sessionId,
        tabId,
        streamId,
        pending.applyUrl,
        { navigate: false },
      );
      captureReady.remember(tabId, pending.applyUrl || tab.url);
      persistCaptureReady();
      rememberLiveSession(
        pending.sessionId,
        tabId,
        pending.job,
        pending.expectedResumeName,
        pending.resumeSetFolder,
      );
      const live = liveSessions.get(pending.sessionId);
      if (live) {
        await armLiveSession(live);
        notifyRecordingStarted(live);
      }
    } catch (error) {
      void chrome.runtime.sendMessage({
        type: "ATHENS_LENS_PENDING_RECORD_FAILED",
        tabId,
        error: error instanceof Error ? error.message : "Could not start recording.",
      }).catch(() => undefined);
    }
  }

  chrome.tabs.onRemoved?.addListener((tabId) => {
    if (pendingRecord?.tabId === tabId) pendingRecord = null;
    forgetTab(tabId);
  });

  chrome.tabs.onUpdated?.addListener?.((tabId, changeInfo) => {
    if (changeInfo.status !== "complete") return;
    const session = liveSessionForTab(tabId);
    if (session) void armLiveSession(session);
  });

  chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
    const senderTabId = asTabId((sender as { tab?: { id?: number } } | null)?.tab?.id);
    if (message?.type === "ATHENS_LENS_PENDING_RECORD") {
      const tabId = asTabId(message.tabId);
      if (tabId == null || !message.sessionId) {
        sendResponse({ ok: false, error: "Missing tab for pending record." });
        return false;
      }
      if (sessionIdForTab(tabId)) {
        sendResponse({
          ok: false,
          tabId,
          error: "This tab is already recording. Complete that bid first.",
        });
        return false;
      }
      pendingRecord = {
        sessionId: String(message.sessionId),
        tabId,
        applyUrl: String(message.applyUrl || "").trim(),
        job: message.job ?? null,
        expectedResumeName: String(message.expectedResumeName || "").trim(),
        resumeSetFolder: String(message.resumeSetFolder || "").trim(),
      };
      sendResponse({
        ok: true,
        tabId,
        pending: true,
        message: "Click the Athens Lens icon on this tab to start recording.",
      });
      return false;
    }

    if (message?.type === "ATHENS_LENS_START_RECORDING") {
      const providedStreamId = typeof message.streamId === "string" ? message.streamId.trim() : "";
      const providedTabId = asTabId(message.tabId);

      // Preferred path: side panel opened apply URL and captured in the click turn.
      if (providedStreamId && providedTabId != null) {
        if (sessionIdForTab(providedTabId)) {
          sendResponse({
            ok: false,
            tabId: providedTabId,
            error: "This tab is already recording. Complete that bid first.",
          });
          return false;
        }
        if (pendingRecord?.tabId === providedTabId) pendingRecord = null;
        finishStartRecording(
          message,
          providedTabId,
          providedStreamId,
          { navigate: false },
          sendResponse,
        );
        return true;
      }

      // Fallback: capture a capture-ready tab from the service worker.
      const tabId = resolveCaptureTabId(message.preferredTabId);
      if (tabId == null) {
        sendResponse({
          ok: false,
          error: "Could not open or capture an application tab. Focus the page and click Record, then the Athens Lens icon if prompted.",
        });
        return false;
      }

      if (sessionIdForTab(tabId)) {
        sendResponse({
          ok: false,
          tabId,
          error: "This tab is already recording. Complete that bid, or open another tab and click the Lens icon there.",
        });
        return false;
      }

      // getMediaStreamId must run in this turn (no awaits before it) or Chrome
      // rejects with the activeTab / "Chrome pages cannot be captured" error.
      getMediaStreamIdSync(tabId, (capture) => {
        if (!capture.streamId) {
          const err = capture.error || "";
          if (/activeTab|invoked for the current page|Chrome pages cannot be captured/i.test(err)) {
            captureReady.forget(tabId);
            persistCaptureReady();
          }
          sendResponse({
            ok: false,
            tabId,
            error: /activeTab|invoked for the current page|Chrome pages cannot be captured/i.test(err)
              ? "Click the Athens Lens icon on this tab to start recording."
              : (err || "Click the Athens Lens icon on this tab, then try Record again."),
          });
          return;
        }

        if (pendingRecord?.tabId === tabId) pendingRecord = null;
        finishStartRecording(
          message,
          tabId,
          capture.streamId,
          { navigate: true },
          sendResponse,
        );
      });
      return true;
    }

    if (message?.type === "ATHENS_LENS_LIST_SESSIONS") {
      sendResponse({ ok: true, sessions: listLiveSessions() });
      return false;
    }

    if (message?.type === "ATHENS_LENS_GET_RESUME_SESSION") {
      const tabId = senderTabId;
      const live = tabId != null ? liveSessionForTab(tabId) : null;
      sendResponse({
        ok: true,
        session: live ? toArmPayload(live) : null,
      });
      return false;
    }

    if (message?.type === "ATHENS_LENS_RESUME_SELECTED") {
      void (async () => {
        const outboxKey = String(message.outboxKey || "");
        const payload = message.payload;
        const tabId = senderTabId
          ?? (payload.sessionId ? liveSessions.get(payload.sessionId)?.tabId ?? null : null)
          ?? null;
        notifySidePanelResumeAudit(payload, tabId);
        if (outboxKey.startsWith(RESUME_AUDIT_OUTBOX_PREFIX)) {
          sendResponse(await persistResumeAuditFromOutbox(outboxKey, payload));
          return;
        }
        try {
          await persistResumeAuditFromOutbox(
            outboxKey || `${RESUME_AUDIT_OUTBOX_PREFIX}ephemeral`,
            payload,
          );
          sendResponse({ ok: true, persisted: true });
        } catch (error) {
          sendResponse({
            ok: false,
            persisted: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      })();
      return true;
    }

    if (message?.type === "ATHENS_LENS_SHOW_TOAST") {
      const tabId = senderTabId;
      const text = String(message.message || "").trim();
      if (tabId != null && text) {
        void chrome.tabs.sendMessage(tabId, { type: "ATHENS_LENS_SHOW_TOAST", message: text }, { frameId: 0 });
      }
      sendResponse({ ok: true });
      return false;
    }

    if (message?.type === "ATHENS_LENS_STOP_RECORDING") {
      void (async () => {
        const live = liveSessions.get(message.sessionId);
        if (live) {
          await disarmResumeSessionOnTab(live.tabId).catch(() => undefined);
        }
        await flushResumeAuditOutbox().catch(() => undefined);
        await ensureOffscreenDocument();
        const response = await sendOffscreenMessage({
          type: "OFFSCREEN_STOP_RECORDING",
          sessionId: message.sessionId,
        });
        const tabId = recordingTabs.get(message.sessionId) ?? null;
        recordingTabs.delete(message.sessionId);
        liveSessions.delete(message.sessionId);
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
