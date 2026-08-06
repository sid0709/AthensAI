/**
 * MAIN-world page hook: renames resume uploads to the profile ATS name and
 * emits original/cleaned filename audits (Bid-Monitor page-hook port).
 *
 * Critical for Lever / Greenhouse analyze-on-select widgets:
 * - Rename during the original capture-phase change event, before ATS code runs.
 * - Never re-dispatch synthetic change/input events.
 * - Never `.bind()` native FormData/XHR methods — bound natives ignore
 *   `.call(instance)` and throw "Illegal invocation".
 * - Preserve the same file bytes, mime type, and last-modified timestamp.
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

type FormDataWrite = (
  this: FormData,
  name: string,
  value: string | Blob,
  fileName?: string,
) => void;

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

  // Unbound natives — always invoke via `.call(formInstance, …)`.
  const nativeAppend = FormData.prototype.append as FormDataWrite;
  const nativeSet = FormData.prototype.set as FormDataWrite;

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

  function forceRenameInputFiles(input: HTMLInputElement) {
    const selectedFiles = Array.from(input.files || []);
    if (!selectedFiles.length) return;

    const transfer = new DataTransfer();
    let renamedAny = false;

    for (const file of selectedFiles) {
      const { originalName, submittedName } = resolveNames(file);
      emitAuditForFile(file, "file-input", originalName, submittedName);

      if (submittedName && submittedName !== file.name) {
        const renamedFile = new File([file], submittedName, {
          type: file.type,
          lastModified: file.lastModified,
        });
        stampOriginalName(renamedFile, originalName);
        transfer.items.add(renamedFile);
        renamedAny = true;
      } else {
        transfer.items.add(file);
      }
    }

    if (renamedAny) input.files = transfer.files;
  }

  function handleFileInputEvent(event: Event) {
    try {
      const input = event.target;
      if (!shouldRename() || !(input instanceof HTMLInputElement) || input.type !== "file") return;
      if (!input.files?.length) return;
      forceRenameInputFiles(input);
    } catch (err) {
      console.warn("Athens Lens: enforced resume rename failed", err);
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

  function writeFilePart(
    write: FormDataWrite,
    form: FormData,
    name: string,
    value: File,
    auditSource: string,
  ) {
    const { originalName, submittedName } = resolveNames(value);
    emitAuditForFile(value, auditSource, originalName, submittedName);
    // Same File bytes + mime; only override Content-Disposition filename.
    if (submittedName && submittedName !== value.name) {
      write.call(form, name, value, submittedName);
      return;
    }
    write.call(form, name, value);
  }

  function rewriteFormData(body: FormData): FormData {
    if (!shouldRename()) return body;
    const next = new FormData();
    for (const [key, value] of body.entries()) {
      if (isFileValue(value)) {
        writeFilePart(nativeAppend, next, key, value, "formdata-send");
      } else {
        nativeAppend.call(next, key, value);
      }
    }
    return next;
  }

  /**
   * Native `<form>` submissions do not necessarily call page-owned `fetch`,
   * XHR, or `FormData.prototype.append`. The browser emits `formdata` with the
   * exact multipart payload immediately before it sends it, which is the last
   * safe point to replace only each file part's wire filename.
   */
  function handleNativeFormData(event: Event) {
    try {
      if (!shouldRename() || !(event instanceof FormDataEvent)) return;

      const entries = Array.from(event.formData.entries());
      const fileFields = new Set(
        entries.filter(([, value]) => isFileValue(value)).map(([name]) => name),
      );
      if (!fileFields.size) return;

      // `set` would discard additional files that share a field name. Rebuild
      // only affected fields with native `append` to preserve every selection.
      for (const name of fileFields) event.formData.delete(name);
      for (const [name, value] of entries) {
        if (!fileFields.has(name)) continue;
        if (isFileValue(value)) {
          writeFilePart(nativeAppend, event.formData, name, value, "native-form-submit");
        } else {
          nativeAppend.call(event.formData, name, value);
        }
      }
    } catch (err) {
      console.warn("Athens Lens: native form resume rename failed", err);
    }
  }

  function patchFormData() {
    if (typeof FormData === "undefined") return;
    const proto = FormData.prototype as typeof FormData.prototype & {
      __athensLensPatched?: boolean;
    };
    if (proto.__athensLensPatched) return;

    proto.append = function athensLensFormDataAppend(
      this: FormData,
      name: string,
      value: string | Blob,
      fileName?: string,
    ) {
      if (shouldRename() && isFileValue(value)) {
        writeFilePart(nativeAppend, this, name, value, "formdata");
        return;
      }
      if (arguments.length >= 3 && value instanceof Blob) {
        nativeAppend.call(this, name, value, fileName);
        return;
      }
      nativeAppend.call(this, name, value);
    } as typeof FormData.prototype.append;

    proto.set = function athensLensFormDataSet(
      this: FormData,
      name: string,
      value: string | Blob,
      fileName?: string,
    ) {
      if (shouldRename() && isFileValue(value)) {
        writeFilePart(nativeSet, this, name, value, "formdata");
        return;
      }
      if (arguments.length >= 3 && value instanceof Blob) {
        nativeSet.call(this, name, value, fileName);
        return;
      }
      nativeSet.call(this, name, value);
    } as typeof FormData.prototype.set;

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
  // Capture covers `formdata` events even when an ATS dispatches them from a
  // nested form without bubbling through a page framework.
  document.addEventListener("formdata", handleNativeFormData, true);
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
