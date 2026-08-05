/**
 * Isolated-world bridge: relays MAIN-world resume audits to the background,
 * arms/disarms the page hook from recording session state, and shows toasts.
 */
import {
  RESUME_AUDIT_OUTBOX_PREFIX,
  resumeAuditOutboxKey,
  type RenameAuditPayload,
} from "../src/recording/resume/resumeFileTracking";

const RELAY_FLAG = "__athensLensResumeRelay";
const SESSION_EVENT = "athens-lens-session";
const TOAST_EVENT = "athens-lens-toast";

type ResumeSessionState = {
  isRecording: boolean;
  sessionId: string;
  jobId: string;
  expectedResumeName: string;
  resumeSetFolder: string;
  companyName: string;
  jobTitle: string;
};

const resumeAuditRelayInFlight = new Set<string>();
let toastEl: HTMLDivElement | null = null;
let toastTimer: number | null = null;

function isTopFrame() {
  try {
    return window.top === window;
  } catch {
    return true;
  }
}

function broadcastSession(detail: ResumeSessionState) {
  window.dispatchEvent(new CustomEvent(SESSION_EVENT, { detail }));
}

function showToast(message: string) {
  if (!isTopFrame()) return;
  if (!toastEl) {
    toastEl = document.createElement("div");
    toastEl.setAttribute("role", "status");
    Object.assign(toastEl.style, {
      position: "fixed",
      zIndex: "2147483647",
      left: "16px",
      bottom: "16px",
      maxWidth: "360px",
      padding: "10px 14px",
      borderRadius: "10px",
      background: "rgba(20, 24, 33, 0.92)",
      color: "#f5f7fb",
      font: "13px/1.4 system-ui, sans-serif",
      boxShadow: "0 8px 24px rgba(0,0,0,0.28)",
      pointerEvents: "none",
    });
    document.documentElement.appendChild(toastEl);
  }
  toastEl.textContent = message;
  toastEl.style.opacity = "1";
  if (toastTimer != null) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    if (toastEl) toastEl.style.opacity = "0";
  }, 4200);
}

async function queueResumeAudit(payload: RenameAuditPayload) {
  if (!payload) return;
  const outboxKey = resumeAuditOutboxKey(payload);
  if (resumeAuditRelayInFlight.has(outboxKey)) return;
  resumeAuditRelayInFlight.add(outboxKey);

  try {
    await chrome.storage.local.set({
      [outboxKey]: {
        payload,
        queuedAt: new Date().toISOString(),
      },
    });

    window.postMessage({
      [RELAY_FLAG]: true,
      type: "RESUME_RENAME_AUDIT_ACK",
      auditKey: payload.auditKey,
    }, "*");

    const response = await chrome.runtime.sendMessage({
      type: "ATHENS_LENS_RESUME_SELECTED",
      payload,
      outboxKey,
    }) as { persisted?: boolean } | undefined;

    if (response?.persisted) {
      await chrome.storage.local.remove(outboxKey);
    }
  } catch (err) {
    console.warn("Athens Lens: queued resume filename audit for retry", err);
  } finally {
    resumeAuditRelayInFlight.delete(outboxKey);
  }
}

async function syncSessionFromBackground() {
  try {
    const response = await chrome.runtime.sendMessage({
      type: "ATHENS_LENS_GET_RESUME_SESSION",
    }) as { ok?: boolean; session?: ResumeSessionState | null } | undefined;
    if (response?.ok && response.session) {
      broadcastSession(response.session);
    }
  } catch {
    // Background may be restarting.
  }
}

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_idle",
  allFrames: true,
  main() {
    window.addEventListener("message", (event) => {
      if (
        event.source !== window
        || event.data?.[RELAY_FLAG] !== true
        || event.data.type !== "RESUME_RENAME_AUDIT"
      ) {
        return;
      }
      void queueResumeAudit(event.data.payload);
    });

    window.addEventListener(TOAST_EVENT, ((event: CustomEvent<{ message?: string }>) => {
      const message = event.detail?.message;
      if (!message) return;
      if (isTopFrame()) showToast(message);
      else {
        void chrome.runtime.sendMessage({ type: "ATHENS_LENS_SHOW_TOAST", message }).catch(() => undefined);
      }
    }) as EventListener);

    window.postMessage({
      [RELAY_FLAG]: true,
      type: "RESUME_RENAME_RELAY_READY",
    }, "*");

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === "ATHENS_LENS_ARM_RESUME_SESSION") {
        broadcastSession({
          isRecording: true,
          sessionId: String(message.sessionId || ""),
          jobId: String(message.jobId || ""),
          expectedResumeName: String(message.expectedResumeName || ""),
          resumeSetFolder: String(message.resumeSetFolder || ""),
          companyName: String(message.companyName || ""),
          jobTitle: String(message.jobTitle || ""),
        });
        sendResponse({ ok: true });
        return false;
      }
      if (message?.type === "ATHENS_LENS_DISARM_RESUME_SESSION") {
        broadcastSession({
          isRecording: false,
          sessionId: "",
          jobId: "",
          expectedResumeName: "",
          resumeSetFolder: "",
          companyName: "",
          jobTitle: "",
        });
        sendResponse({ ok: true });
        return false;
      }
      if (message?.type === "ATHENS_LENS_SHOW_TOAST") {
        const text = String(message.message || "").trim();
        if (text) showToast(text);
        sendResponse({ ok: true });
        return false;
      }
      return false;
    });

    void syncSessionFromBackground();

    // Prefix kept for outbox discovery / debugging in storage.
    void RESUME_AUDIT_OUTBOX_PREFIX;
  },
});
