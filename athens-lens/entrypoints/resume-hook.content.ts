/**
 * MAIN-world page hook: renames resume uploads to the profile ATS name and
 * emits original/cleaned filename audits (Bid-Monitor page-hook port).
 *
 * Critical for Lever (and similar analyze-on-select widgets):
 * Never swap `input.files` or re-dispatch synthetic change/input. That races
 * their upload/parser and leaves "Analyzing resume…" spinning forever.
 * Instead: leave the native File selection alone, audit on select, and only
 * override the multipart filename when the page builds FormData / sends it.
 */
import {
  buildRenameAudit,
  buildSubmittedFileName,
  createTracker,
  resumeBasename,
} from "../src/recording/resume/resumeFileTracking";

const RELAY_FLAG = "__athensLensResumeRelay";
const ORIGINAL_PROP = "__athensLensOriginalName";
const SESSION_EVENT = "athens-lens-session";
const TOAST_EVENT = "athens-lens-toast";

type SessionDetail = {
  isRecording?: boolean;
  sessionId?: string;
  jobId?: string;
  expectedResumeName?: string;
  resumeSetFolder?: string;
  companyName?: string;
  jobTitle?: string;
};

function installAthensLensResumeHook() {
  const root = globalThis as typeof globalThis & {
    __athensLensPageHook?: boolean;
  };
  if (root.__athensLensPageHook) return;
  root.__athensLensPageHook = true;

  let resumeSetFolder = "";
  let expectedResumeName = "";
  let activeSessionId = "";
  let activeJobId = "";
  let activeCompanyName = "";
  let activeJobTitle = "";
  let trackingSessionKey = "";
  let isRecording = false;
  const fileTracker = createTracker();
  const pendingAuditPayloads = new Map<string, Record<string, unknown>>();

  window.addEventListener(SESSION_EVENT, ((event: CustomEvent<SessionDetail>) => {
    const detail = event.detail || {};
    const nextFolder = String(detail.resumeSetFolder || "").trim();
    const nextExpectedName = String(detail.expectedResumeName || "").trim();
    const nextSessionId = String(detail.sessionId || "").trim();
    const nextJobId = String(detail.jobId || "").trim();
    const nextIsRecording = !!detail.isRecording;
    const nextTrackingKey = nextIsRecording
      ? nextSessionId || `${nextExpectedName}|${nextFolder}`
      : "";

    if (nextTrackingKey !== trackingSessionKey) {
      fileTracker.reset(nextTrackingKey);
      pendingAuditPayloads.clear();
      trackingSessionKey = nextTrackingKey;
    }

    resumeSetFolder = nextFolder;
    expectedResumeName = nextExpectedName;
    activeSessionId = nextSessionId;
    activeJobId = nextJobId;
    activeCompanyName = String(detail.companyName || "").trim();
    activeJobTitle = String(detail.jobTitle || "").trim();
    isRecording = nextIsRecording;
  }) as EventListener);

  function isFileValue(value: unknown): value is File {
    if (!value || typeof value !== "object") return false;
    if (value instanceof File) return true;
    if (!(value instanceof Blob)) return false;
    const candidate = value as Blob & { name?: unknown; arrayBuffer?: unknown };
    return (
      typeof candidate.name === "string"
      && typeof candidate.size === "number"
      && typeof candidate.arrayBuffer === "function"
    );
  }

  function stampOriginalName(file: File, originalName: string): File {
    try {
      Object.defineProperty(file, ORIGINAL_PROP, {
        value: originalName,
        enumerable: false,
        configurable: true,
      });
    } catch {
      (file as File & Record<string, string>)[ORIGINAL_PROP] = originalName;
    }
    return file;
  }

  function getStampedOriginal(file: File): string | null {
    const value = (file as File & Record<string, unknown>)[ORIGINAL_PROP];
    return typeof value === "string" && value.length ? value : null;
  }

  function shouldRename() {
    return isRecording && (expectedResumeName.length > 0 || resumeSetFolder.length > 0);
  }

  /** Resolve original → ATS submitted name without cloning the File. */
  function resolveNames(file: File) {
    if (!shouldRename() || !isFileValue(file)) {
      return { originalName: file?.name || "", submittedName: file?.name || "" };
    }
    const provisionalName = buildSubmittedFileName(
      file.name,
      expectedResumeName,
      resumeSetFolder,
    );
    const originalName = fileTracker.resolveOriginal(
      file,
      provisionalName,
      getStampedOriginal(file),
    );
    const submittedName = buildSubmittedFileName(
      originalName,
      expectedResumeName,
      resumeSetFolder,
    );
    stampOriginalName(file, originalName);
    return { originalName, submittedName };
  }

  function notifyResumeSelected(payload: Record<string, unknown>) {
    const auditKey = String(payload.auditKey || "");
    if (auditKey) pendingAuditPayloads.set(auditKey, payload);
    window.postMessage({
      [RELAY_FLAG]: true,
      type: "RESUME_RENAME_AUDIT",
      payload,
    }, "*");
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.[RELAY_FLAG] !== true) return;
    if (event.data.type === "RESUME_RENAME_AUDIT_ACK") {
      const auditKey = String(event.data.auditKey || "");
      if (auditKey) pendingAuditPayloads.delete(auditKey);
      return;
    }
    if (event.data.type === "RESUME_RENAME_RELAY_READY") {
      for (const payload of pendingAuditPayloads.values()) {
        window.postMessage({
          [RELAY_FLAG]: true,
          type: "RESUME_RENAME_AUDIT",
          payload,
        }, "*");
      }
    }
  });

  function notifyToast(message: string) {
    window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: { message } }));
  }

  function emitAuditForFile(
    file: File,
    source: string,
    resolvedOriginalName: string,
    submittedName: string,
  ) {
    const originalName = resumeBasename(
      resolvedOriginalName || getStampedOriginal(file) || file.name,
    );
    // Wire / ATS name — may differ from file.name when we only override multipart.
    const cleanedName = resumeBasename(submittedName || file.name);
    const expected = cleanedName;
    const payload = buildRenameAudit({
      sessionId: activeSessionId,
      jobId: activeJobId,
      originalName,
      uploadedName: cleanedName,
      expectedName: expected,
      fileSize: file.size,
      lastModified: file.lastModified,
      mimeType: file.type,
      pageUrl: location.href,
      pageTitle: document.title,
      source,
      company: activeCompanyName,
      title: activeJobTitle,
    });
    payload.auditKey = fileTracker.buildAuditKey(payload);
    if (!fileTracker.shouldEmit(payload)) return;

    notifyResumeSelected(payload as unknown as Record<string, unknown>);

    if (payload.mismatch) {
      notifyToast(`Résumé name mismatch: got “${originalName}”, expected “${expected}”`);
    } else if (payload.renamed) {
      notifyToast(`Uploading as ${cleanedName}`);
    }
  }

  function auditFileList(fileList: FileList | File[], source: string) {
    if (!shouldRename() || !fileList?.length) return;
    for (const file of Array.from(fileList)) {
      if (!isFileValue(file)) continue;
      const { originalName, submittedName } = resolveNames(file);
      emitAuditForFile(file, source, originalName, submittedName);
    }
  }

  function handleFileInputEvent(event: Event) {
    try {
      const input = event.target;
      if (!shouldRename() || !(input instanceof HTMLInputElement) || input.type !== "file") return;
      if (!input.files?.length) return;
      // Audit only — do not mutate files or stopPropagation (breaks Lever analyze).
      auditFileList(input.files, "file-input");
    } catch (err) {
      console.warn("Athens Lens: resume audit failed", err);
    }
  }

  function handleDropEvent(event: DragEvent) {
    try {
      if (!shouldRename() || !event.dataTransfer?.files?.length) return;
      const files = Array.from(event.dataTransfer.files).filter((file) =>
        /\.(pdf|docx)$/i.test(file.name),
      );
      if (!files.length) return;
      auditFileList(files, "drag-drop");
    } catch (err) {
      console.warn("Athens Lens: drag-drop resume audit failed", err);
    }
  }

  function appendWithAtsName(
    method: (name: string, value: string | Blob, fileName?: string) => void,
    form: FormData,
    name: string,
    value: File,
  ) {
    const { originalName, submittedName } = resolveNames(value);
    emitAuditForFile(value, "formdata", originalName, submittedName);
    // Keep the same Blob/File bytes + mime; only override Content-Disposition filename.
    if (submittedName && submittedName !== value.name) {
      return method.call(form, name, value, submittedName);
    }
    return method.call(form, name, value);
  }

  let nativeFormDataAppend: (name: string, value: string | Blob, fileName?: string) => void = (
    FormData.prototype.append as (name: string, value: string | Blob, fileName?: string) => void
  ).bind(FormData.prototype);

  function rewriteFormData(body: FormData): FormData {
    if (!shouldRename()) return body;
    const next = new FormData();
    for (const [key, value] of body.entries()) {
      if (isFileValue(value)) {
        // Use native append — never the patched prototype (avoids recursion).
        appendWithAtsName(nativeFormDataAppend, next, key, value);
      } else {
        nativeFormDataAppend.call(next, key, value);
      }
    }
    return next;
  }

  function patchFormData() {
    if (typeof FormData === "undefined") return;
    const proto = FormData.prototype as typeof FormData.prototype & {
      __athensLensPatched?: boolean;
    };
    if (proto.__athensLensPatched) return;
    const originalAppend = FormData.prototype.append.bind(FormData.prototype);
    const originalSet = FormData.prototype.set.bind(FormData.prototype);
    nativeFormDataAppend = originalAppend;

    function wrap(method: (name: string, value: string | Blob, fileName?: string) => void) {
      return function (
        this: FormData,
        name: string,
        value: string | Blob,
        fileName?: string,
      ) {
        if (shouldRename() && isFileValue(value)) {
          return appendWithAtsName(method, this, name, value);
        }
        if (arguments.length >= 3 && value instanceof Blob) {
          return method.call(this, name, value, fileName);
        }
        return method.call(this, name, value);
      };
    }

    FormData.prototype.append = wrap(originalAppend) as typeof FormData.prototype.append;
    FormData.prototype.set = wrap(originalSet) as typeof FormData.prototype.set;
    proto.__athensLensPatched = true;
  }

  function patchNetwork() {
    const g = globalThis as typeof globalThis & {
      __athensLensNetworkPatched?: boolean;
      fetch: typeof fetch;
      XMLHttpRequest: typeof XMLHttpRequest;
    };
    if (g.__athensLensNetworkPatched) return;
    g.__athensLensNetworkPatched = true;

    if (typeof g.fetch === "function") {
      const originalFetch = g.fetch.bind(g);
      g.fetch = function athensLensFetch(
        input: RequestInfo | URL,
        init?: RequestInit,
      ): Promise<Response> {
        if (shouldRename() && init?.body instanceof FormData) {
          return originalFetch(input, { ...init, body: rewriteFormData(init.body) });
        }
        return originalFetch(input, init);
      } as typeof fetch;
    }

    if (typeof g.XMLHttpRequest === "function") {
      const originalSend = g.XMLHttpRequest.prototype.send;
      g.XMLHttpRequest.prototype.send = function athensLensXhrSend(
        this: XMLHttpRequest,
        body?: Document | XMLHttpRequestBodyInit | null,
      ) {
        if (shouldRename() && body instanceof FormData) {
          return originalSend.call(this, rewriteFormData(body));
        }
        return originalSend.call(this, body);
      };
    }
  }

  document.addEventListener("change", handleFileInputEvent, true);
  document.addEventListener("drop", handleDropEvent, true);
  patchFormData();
  patchNetwork();
}

export default defineContentScript({
  matches: ["<all_urls>"],
  world: "MAIN",
  runAt: "document_start",
  allFrames: true,
  main() {
    installAthensLensResumeHook();
  },
});
