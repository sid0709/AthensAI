/**
 * MAIN-world page hook: renames resume uploads to the profile ATS name and
 * emits original/cleaned filename audits (Bid-Monitor page-hook port).
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

  function renameFile(file: File, newName: string, originalName: string): File {
    if (file.name === newName) {
      return stampOriginalName(file, originalName || getStampedOriginal(file) || file.name);
    }
    const next = new File([file], newName, {
      type: file.type || "application/octet-stream",
      lastModified: file.lastModified ?? Date.now(),
    });
    return stampOriginalName(next, originalName || getStampedOriginal(file) || file.name);
  }

  function shouldRename() {
    return isRecording && (expectedResumeName.length > 0 || resumeSetFolder.length > 0);
  }

  function prepareFile(file: File) {
    if (!shouldRename() || !isFileValue(file)) {
      return { file, originalName: file?.name || "", submittedName: file?.name || "" };
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
    return {
      file: renameFile(file, submittedName, originalName),
      originalName,
      submittedName,
    };
  }

  function replaceInputFiles(input: HTMLInputElement, files: File[]) {
    if (!(input instanceof HTMLInputElement) || input.type !== "file") return false;
    const dt = new DataTransfer();
    for (const file of files) dt.items.add(file);
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "files");
    if (descriptor?.set) descriptor.set.call(input, dt.files);
    else input.files = dt.files;
    return true;
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
    const cleanedName = resumeBasename(file.name);
    const expected = resumeBasename(submittedName || cleanedName);
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

  function processFiles(fileList: FileList | File[], source: string) {
    if (!shouldRename() || !fileList?.length) return null;
    const originalFiles = Array.from(fileList);
    const renamedFiles: File[] = [];
    for (const file of originalFiles) {
      const prepared = prepareFile(file);
      renamedFiles.push(prepared.file);
      emitAuditForFile(
        prepared.file,
        source,
        prepared.originalName,
        prepared.submittedName,
      );
    }
    return renamedFiles;
  }

  function handleFileInputEvent(event: Event) {
    try {
      const input = event.target;
      if (!shouldRename() || !(input instanceof HTMLInputElement) || input.type !== "file") return;
      if (!input.files?.length) return;
      const renamedFiles = processFiles(input.files, "file-input");
      if (renamedFiles) replaceInputFiles(input, renamedFiles);
    } catch (err) {
      console.warn("Athens Lens: resume rename failed", err);
    }
  }

  function handleDropEvent(event: DragEvent) {
    try {
      if (!shouldRename() || !event.dataTransfer?.files?.length) return;
      const files = Array.from(event.dataTransfer.files).filter((file) =>
        /\.(pdf|docx)$/i.test(file.name),
      );
      if (!files.length) return;
      const renamed = processFiles(files, "drag-drop");
      if (!renamed) return;

      const path = typeof event.composedPath === "function" ? event.composedPath() : [];
      const input = path.find(
        (node): node is HTMLInputElement =>
          node instanceof HTMLInputElement && node.type === "file",
      );
      if (input) replaceInputFiles(input, renamed);

      try {
        const dt = new DataTransfer();
        for (const file of renamed) dt.items.add(file);
        Object.defineProperty(event, "dataTransfer", {
          configurable: true,
          value: dt,
        });
      } catch {
        // Some browsers block redefining dataTransfer.
      }
    } catch (err) {
      console.warn("Athens Lens: drag-drop rename failed", err);
    }
  }

  function handleSubmitEvent(event: Event) {
    try {
      if (!shouldRename()) return;
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      for (const input of form.querySelectorAll('input[type="file"]')) {
        if (!(input instanceof HTMLInputElement) || !input.files?.length) continue;
        const renamedFiles = processFiles(input.files, "form-submit");
        if (renamedFiles) replaceInputFiles(input, renamedFiles);
      }
    } catch (err) {
      console.warn("Athens Lens: submit-time resume audit failed", err);
    }
  }

  function patchFormData() {
    if (typeof FormData === "undefined") return;
    const proto = FormData.prototype as typeof FormData.prototype & {
      __athensLensPatched?: boolean;
    };
    if (proto.__athensLensPatched) return;
    const originalAppend = FormData.prototype.append.bind(FormData.prototype);
    const originalSet = FormData.prototype.set.bind(FormData.prototype);

    function wrap(method: (name: string, value: string | Blob, fileName?: string) => void) {
      return function (
        this: FormData,
        name: string,
        value: string | Blob,
        fileName?: string,
      ) {
        if (shouldRename() && isFileValue(value)) {
          const prepared = prepareFile(value);
          emitAuditForFile(
            prepared.file,
            "formdata",
            prepared.originalName,
            prepared.submittedName,
          );
          return method.call(this, name, prepared.file, prepared.file.name);
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

  document.addEventListener("change", handleFileInputEvent, true);
  document.addEventListener("input", handleFileInputEvent, true);
  document.addEventListener("drop", handleDropEvent, true);
  document.addEventListener("submit", handleSubmitEvent, true);
  patchFormData();
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
