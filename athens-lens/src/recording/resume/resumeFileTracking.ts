/**
 * Resume upload rename + audit helpers — ported from Bid-Monitor
 * content/resume-file-tracking.js for Athens Lens.
 */

import { resumeBasename } from "./canonicalResumeName";

export { resumeBasename };

export const RESUME_AUDIT_OUTBOX_PREFIX = "athensLensResumeAudit:";

export function getExtension(fileName: string): string {
  const base = resumeBasename(fileName);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot) : "";
}

function sanitizeForFileName(value: unknown): string {
  return String(value || "")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 60);
}

/**
 * Rename selected resume to the recruiter-facing profile name while keeping
 * the original extension (e.g. Backend.pdf → Eli Taylor.pdf).
 */
export function buildSubmittedFileName(
  originalName: string,
  expectedResumeName: string,
  fallbackFolder?: string | null,
): string {
  const expected = resumeBasename(expectedResumeName);
  const originalExt = getExtension(originalName);
  const expectedExt = getExtension(expected);
  const ext = originalExt || expectedExt || ".pdf";

  if (expected) {
    const stem = expectedExt ? expected.slice(0, -expectedExt.length) : expected;
    return `${stem}${ext}`;
  }

  const safe = sanitizeForFileName(fallbackFolder);
  return safe ? `${safe}${ext}` : resumeBasename(originalName);
}

export interface RenameAuditInput {
  originalName?: string | null;
  uploadedName?: string | null;
  expectedName?: string | null;
  sessionId?: string | null;
  jobId?: string | null;
  fileSize?: number | null;
  lastModified?: number | null;
  mimeType?: string | null;
  pageUrl?: string | null;
  pageTitle?: string | null;
  source?: string | null;
  company?: string | null;
  title?: string | null;
}

export interface RenameAuditPayload {
  sessionId: string | null;
  jobId: string | null;
  originalFileName: string;
  originalName: string;
  submittedFileName: string;
  cleanedName: string;
  expectedName: string | null;
  renamed: boolean;
  mismatch: boolean;
  fileName: string;
  fileSize: number;
  lastModified: number;
  mimeType: string | null;
  pageUrl: string | null;
  pageTitle: string | null;
  source: string | null;
  company: string | null;
  title: string | null;
  auditKey?: string;
}

export function buildRenameAudit(input: RenameAuditInput): RenameAuditPayload {
  const original = resumeBasename(input.originalName);
  const uploaded = resumeBasename(input.uploadedName);
  const expected = resumeBasename(input.expectedName) || uploaded;
  return {
    sessionId: String(input.sessionId || "").trim() || null,
    jobId: String(input.jobId || "").trim() || null,
    originalFileName: original,
    originalName: original,
    submittedFileName: uploaded,
    cleanedName: uploaded,
    expectedName: expected || null,
    renamed: Boolean(original && uploaded && original !== uploaded),
    mismatch: Boolean(expected && uploaded && expected !== uploaded),
    fileName: original,
    fileSize: Number(input.fileSize) || 0,
    lastModified: Number(input.lastModified) || 0,
    mimeType: String(input.mimeType || "").trim() || null,
    pageUrl: String(input.pageUrl || "").trim() || null,
    pageTitle: String(input.pageTitle || "").trim() || null,
    source: String(input.source || "").trim() || null,
    company: String(input.company || "").trim() || null,
    title: String(input.title || "").trim() || null,
  };
}

export function resumeAuditOutboxKey(payload: Partial<RenameAuditPayload> & { auditKey?: string }): string {
  const seed = String(
    payload?.auditKey || [
      payload?.sessionId || "",
      payload?.jobId || "",
      resumeBasename(payload?.originalName || payload?.originalFileName),
      resumeBasename(payload?.cleanedName || payload?.submittedFileName),
      Number(payload?.fileSize) || 0,
      payload?.mimeType || "",
    ].join("|"),
  );
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const session = sanitizeForFileName(payload?.sessionId || "session").slice(0, 40) || "session";
  return `${RESUME_AUDIT_OUTBOX_PREFIX}${session}:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

type FileLike = {
  name?: string;
  size?: number;
  type?: string;
  lastModified?: number;
};

function exactFileKey(file: FileLike | null | undefined): string {
  return [
    Number(file?.size) || 0,
    String(file?.type || ""),
    Number(file?.lastModified) || 0,
  ].join("|");
}

function contentFileKey(file: FileLike | null | undefined): string {
  return [Number(file?.size) || 0, String(file?.type || "")].join("|");
}

export function createTracker() {
  let sessionKey = "";
  const originalByExactFile = new Map<string, string>();
  const originalByContent = new Map<string, string>();
  const emittedAuditKeys = new Set<string>();

  function reset(nextSessionKey = "") {
    sessionKey = String(nextSessionKey || "");
    originalByExactFile.clear();
    originalByContent.clear();
    emittedAuditKeys.clear();
  }

  function rememberOriginal(file: FileLike, originalName: string) {
    const original = resumeBasename(originalName);
    if (!original) return "";
    originalByExactFile.set(exactFileKey(file), original);
    originalByContent.set(contentFileKey(file), original);
    return original;
  }

  function resolveOriginal(
    file: FileLike,
    expectedSubmittedName: string,
    stampedOriginalName?: string | null,
  ) {
    const stamped = resumeBasename(stampedOriginalName);
    if (stamped) return rememberOriginal(file, stamped);

    const current = resumeBasename(file?.name);
    const expected = resumeBasename(expectedSubmittedName);
    if (expected && current === expected) {
      const remembered =
        originalByExactFile.get(exactFileKey(file))
        || originalByContent.get(contentFileKey(file));
      if (remembered) return remembered;
    }

    return rememberOriginal(file, current);
  }

  function buildAuditKey(payload: Partial<RenameAuditPayload>) {
    return [
      sessionKey,
      resumeBasename(payload?.originalName),
      resumeBasename(payload?.cleanedName),
      Number(payload?.fileSize) || 0,
      String(payload?.mimeType || ""),
    ].join("|");
  }

  function shouldEmit(payload: Partial<RenameAuditPayload>) {
    const key = buildAuditKey(payload);
    if (emittedAuditKeys.has(key)) return false;
    emittedAuditKeys.add(key);
    return true;
  }

  return { reset, resolveOriginal, buildAuditKey, shouldEmit };
}
