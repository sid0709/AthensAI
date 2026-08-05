import { ATHENS_API_BASE_URL, AthensApiError } from "../../api/athensApi";
import { athensAuthStore } from "../../auth/authStore";
import {
  RESUME_AUDIT_OUTBOX_PREFIX,
  resumeBasename,
  type RenameAuditPayload,
} from "./resumeFileTracking";

export type ResumeSessionArmPayload = {
  isRecording: boolean;
  sessionId: string;
  jobId: string;
  expectedResumeName: string;
  resumeSetFolder: string;
  companyName: string;
  jobTitle: string;
};

export async function saveAthensLensResumeAudit(payload: RenameAuditPayload) {
  const session = await athensAuthStore.restore();
  if (!session?.accessToken) {
    throw new AthensApiError("Sign in required to save résumé audit.", 401);
  }

  const originalName = resumeBasename(payload.originalName || payload.originalFileName);
  const cleanedName = resumeBasename(payload.cleanedName || payload.submittedFileName);
  const jobId = String(payload.jobId || "").trim();
  if (!originalName || !jobId) {
    throw new AthensApiError("Resume audit is missing originalName or jobId.", 400);
  }

  const response = await fetch(`${ATHENS_API_BASE_URL}/athens-lens/bids/resume-audit`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.accessToken}`,
    },
    body: JSON.stringify({
      jobId,
      originalName,
      expectedName: resumeBasename(payload.expectedName) || undefined,
      cleanedName: cleanedName || undefined,
      renamed: Boolean(payload.renamed),
      company: payload.company || undefined,
      title: payload.title || undefined,
      pageUrl: payload.pageUrl || undefined,
      sessionId: payload.sessionId || undefined,
      source: payload.source || "athens-lens",
      fileSize: Number(payload.fileSize) || undefined,
      lastModified: Number(payload.lastModified) || undefined,
      mimeType: payload.mimeType || undefined,
      auditKey: payload.auditKey || undefined,
    }),
  });

  const body = await response.json().catch(() => null) as {
    success?: boolean;
    message?: string;
    error?: string;
  } | null;
  if (!response.ok) {
    throw new AthensApiError(
      body?.message || body?.error || "Could not save résumé audit.",
      response.status,
    );
  }
  return body;
}

export async function persistResumeAuditFromOutbox(
  outboxKey: string,
  payload: RenameAuditPayload,
): Promise<{ ok: boolean; persisted: boolean; error?: string }> {
  try {
    await saveAthensLensResumeAudit(payload);
    await chrome.storage.local.remove(outboxKey);
    return { ok: true, persisted: true };
  } catch (error) {
    console.warn("Athens Lens: resume audit persist pending", error);
    return {
      ok: false,
      persisted: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function flushResumeAuditOutbox() {
  const stored = await chrome.storage.local.get(null);
  const pending = Object.entries(stored).filter(([key]) =>
    key.startsWith(RESUME_AUDIT_OUTBOX_PREFIX),
  );
  for (const [outboxKey, entry] of pending) {
    const payload = (entry as { payload?: RenameAuditPayload } | null)?.payload;
    if (!payload) {
      await chrome.storage.local.remove(outboxKey);
      continue;
    }
    await persistResumeAuditFromOutbox(outboxKey, payload);
  }
}

export function tabsSendMessage(tabId: number, message: unknown): Promise<unknown> {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      void chrome.runtime.lastError;
      resolve(response);
    });
  });
}

export async function armResumeSessionOnTab(
  tabId: number,
  session: ResumeSessionArmPayload,
) {
  await tabsSendMessage(tabId, {
    type: "ATHENS_LENS_ARM_RESUME_SESSION",
    ...session,
    isRecording: true,
  });
}

export async function disarmResumeSessionOnTab(tabId: number) {
  await tabsSendMessage(tabId, { type: "ATHENS_LENS_DISARM_RESUME_SESSION" });
}
