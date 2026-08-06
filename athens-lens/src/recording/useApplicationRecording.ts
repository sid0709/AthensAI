import { useEffect, useMemo, useRef } from "react";
import type { Job, Session } from "../types";
import type { FormAnswer, PageContext } from "./askAi";
import { finishAthensLensBid, startAthensLensBid } from "./bidPersist";
import {
  buildProfileResumeFileName,
  profileNameToFileBase,
} from "./resume/canonicalResumeName";
import {
  createIdleSession,
  selectRecordingJobIds,
  toApplicationRecordingState,
  useRecordingSessionsStore,
  type ApplicationRecordingState,
  type RecordingStatus,
  type TabRecordingSession,
} from "./recordingSessionsStore";
import { useTabWorkspaceStore } from "../state/tabWorkspaceStore";

export type { ApplicationRecordingState, RecordingStatus };
export { selectRecordingJobIds };

type JobSnapshot = {
  id: string;
  title: string;
  company: string;
  applyUrl: string;
  companyLogoUrl?: string;
  location?: string;
  workMode?: Job["workMode"];
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

type StartResponse =
  | { ok: true; tabId: number }
  | { ok: false; tabId?: number; error?: string };

type StopResponse =
  | { ok: true; tabId: number | null; filename?: string; mimeType?: string; byteLength?: number }
  | { ok: false; tabId?: number | null; error?: string };

type LiveSessionResponse = {
  sessionId: string;
  tabId: number;
  job: JobSnapshot | null;
  startedAt: number;
};

function extensionApi() {
  const root = globalThis as typeof globalThis & {
    chrome?: typeof chrome;
    browser?: typeof chrome;
  };
  return root.chrome ?? root.browser ?? null;
}

function jobSnapshot(job: Job): JobSnapshot {
  return {
    id: job.id,
    title: job.title,
    company: job.company,
    applyUrl: job.applyUrl,
    companyLogoUrl: job.companyLogoUrl,
    location: job.location,
    workMode: job.workMode,
    employmentType: job.employmentType,
    seniority: job.seniority,
    salary: job.salary,
    experience: job.experience,
    postedAt: job.postedAt,
    skills: job.skills,
    tags: job.tags,
    applicantsText: job.applicantsText,
    description: job.description,
    responsibilities: job.responsibilities,
    qualifications: job.qualifications,
  };
}

function jobFromSnapshot(snapshot: JobSnapshot): Job {
  return {
    id: snapshot.id,
    title: snapshot.title,
    company: snapshot.company,
    applyUrl: snapshot.applyUrl,
    companyLogoUrl: snapshot.companyLogoUrl ?? "",
    location: snapshot.location ?? "",
    workMode: snapshot.workMode ?? "Remote",
    employmentType: snapshot.employmentType ?? "",
    seniority: snapshot.seniority ?? "",
    salary: snapshot.salary ?? "",
    experience: snapshot.experience ?? "",
    postedAt: snapshot.postedAt ?? "",
    skills: snapshot.skills ?? [],
    tags: snapshot.tags ?? [],
    applicantsText: snapshot.applicantsText ?? "",
    description: snapshot.description ?? "",
    responsibilities: snapshot.responsibilities ?? [],
    qualifications: snapshot.qualifications ?? [],
  };
}

function isHttpTabUrl(url: string | undefined | null) {
  return /^https?:/i.test(url || "");
}

function normalizeApplyUrl(url: string | undefined | null): string | null {
  const raw = String(url || "").trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw.startsWith("//") ? `https:${raw}` : raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}


function friendlyCaptureError(message: string | undefined | null) {
  return message || "Could not capture this tab.";
}

/**
 * Open the job apply URL in a new focused tab. Does not start recording.
 */
function openApplyTab(
  api: NonNullable<ReturnType<typeof extensionApi>>,
  applyUrl: string,
): Promise<{ ok: true; tabId: number } | { ok: false; error: string }> {
  if (!api.tabs?.create) {
    return Promise.resolve({
      ok: false,
      error: "Opening apply links requires the Athens Lens Chrome extension.",
    });
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: { ok: true; tabId: number } | { ok: false; error: string }) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const onTabCreated = (tab: chrome.tabs.Tab | undefined) => {
      const createError = api.runtime?.lastError?.message;
      if (createError || tab?.id == null) {
        finish({ ok: false, error: createError || "Could not open the application page." });
        return;
      }
      const tabId = tab.id;
      const openedUrl = String(tab.url || "");
      if (!isHttpTabUrl(openedUrl) && api.tabs.update) {
        api.tabs.update(tabId, { url: applyUrl, active: true }, () => {
          void api.runtime?.lastError;
          finish({ ok: true, tabId });
        });
        return;
      }
      finish({ ok: true, tabId });
    };

    try {
      const created = api.tabs.create(
        { url: applyUrl, active: true },
        onTabCreated,
      ) as unknown as Promise<chrome.tabs.Tab> | void;
      if (created && typeof (created as Promise<chrome.tabs.Tab>).then === "function") {
        void (created as Promise<chrome.tabs.Tab>)
          .then((tab) => onTabCreated(tab))
          .catch((error: unknown) => {
            finish({
              ok: false,
              error: error instanceof Error ? error.message : "Could not open the application page.",
            });
          });
      }
    } catch (error) {
      finish({
        ok: false,
        error: error instanceof Error ? error.message : "Could not open the application page.",
      });
    }
  });
}

/**
 * Open Chrome's tab-only capture picker in the Record click turn. This path
 * does not require an activeTab grant from the toolbar action.
 */
function chooseTabCaptureStream(
  api: NonNullable<ReturnType<typeof extensionApi>>,
): Promise<
  { ok: true; streamId: string; captureSource: "desktop" }
  | { ok: false; error: string }
> {
  if (!api.desktopCapture?.chooseDesktopMedia) {
    return Promise.resolve({
      ok: false,
      error: "Tab recording is only available in the Athens Lens Chrome extension.",
    });
  }

  return new Promise((resolve) => {
    try {
      api.desktopCapture.chooseDesktopMedia(["tab"], (streamId) => {
        const captureError = api.runtime?.lastError?.message;
        if (captureError || !streamId) {
          resolve({
            ok: false,
            error: captureError || "Tab selection was canceled.",
          });
          return;
        }
        resolve({ ok: true, streamId, captureSource: "desktop" });
      });
    } catch (error) {
      resolve({
        ok: false,
        error: error instanceof Error ? error.message : "Could not open the tab selector.",
      });
    }
  });
}

function normalizeStartResponse(response: StartResponse | undefined): StartResponse {
  if (response?.ok && response.tabId != null) {
    return { ok: true, tabId: response.tabId };
  }
  return {
    ok: false,
    tabId: response && "tabId" in response ? response.tabId : undefined,
    error: (!response?.ok && response?.error) || "Could not start the recorder.",
  };
}

function sendStartRecording(
  api: NonNullable<ReturnType<typeof extensionApi>>,
  applyUrl: string,
  sessionId: string,
  job: Job,
  session: Session,
  payload: Record<string, unknown>,
): Promise<StartResponse> {
  const bidderName = session.displayName || session.username;
  const expectedResumeName = buildProfileResumeFileName(bidderName, ".pdf");
  const resumeSetFolder = profileNameToFileBase(bidderName) || "";

  return Promise.resolve(
    api.runtime.sendMessage({
      type: "ATHENS_LENS_START_RECORDING",
      applyUrl,
      sessionId,
      job: jobSnapshot(job),
      expectedResumeName,
      resumeSetFolder,
      bidderName,
      ...payload,
    }) as Promise<StartResponse | undefined>,
  )
    .then(normalizeStartResponse)
    .catch((error: unknown) => ({
      ok: false as const,
      error: error instanceof Error ? error.message : "Could not start the recorder.",
    }));
}

async function stopTabRecording(sessionId: string): Promise<StopResponse> {
  const api = extensionApi();
  if (!api?.runtime?.sendMessage) {
    return { ok: false, error: "Tab recording is only available in the Athens Lens Chrome extension." };
  }
  try {
    const response = await api.runtime.sendMessage({
      type: "ATHENS_LENS_STOP_RECORDING",
      sessionId,
    }) as StopResponse | undefined;
    if (!response) {
      return { ok: false, error: "Could not stop recording." };
    }
    return response;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not stop recording.",
    };
  }
}

async function listLiveSessions(): Promise<LiveSessionResponse[]> {
  const api = extensionApi();
  if (!api?.runtime?.sendMessage) return [];
  try {
    const response = await api.runtime.sendMessage({
      type: "ATHENS_LENS_LIST_SESSIONS",
    }) as { ok?: boolean; sessions?: LiveSessionResponse[] } | undefined;
    return response?.ok && Array.isArray(response.sessions) ? response.sessions : [];
  } catch {
    return [];
  }
}

async function queryActiveTab(): Promise<{ id: number; url?: string } | null> {
  const api = extensionApi();
  if (!api?.tabs?.query) return null;
  try {
    const tabs = await new Promise<chrome.tabs.Tab[]>((resolve, reject) => {
      api.tabs.query({ active: true, lastFocusedWindow: true }, (result) => {
        const error = api.runtime?.lastError?.message;
        if (error) reject(new Error(error));
        else resolve(result || []);
      });
    });
    const tab = tabs[0];
    if (tab?.id == null) return null;
    return { id: tab.id, url: tab.url };
  } catch {
    return null;
  }
}

async function queryActiveTabId(): Promise<number | null> {
  const tab = await queryActiveTab();
  return tab?.id ?? null;
}

function createSessionId(jobId: string) {
  return `lens-${jobId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function selectUiSession(
  focusedTabId: number | null,
  sessionsByTabId: Record<number, TabRecordingSession>,
): TabRecordingSession | null {
  // Strict per-tab UI: never show another tab's bid chrome on this tab.
  if (focusedTabId == null) return null;
  return sessionsByTabId[focusedTabId] ?? null;
}

export interface FinishBidContext {
  session: Session;
  answers?: FormAnswer[];
  summary?: string;
  pageContext?: PageContext | null;
  mode?: string;
}

export function useApplicationRecording() {
  const focusedTabId = useRecordingSessionsStore((state) => state.focusedTabId);
  const sessionsByTabId = useRecordingSessionsStore((state) => state.sessionsByTabId);
  const panelError = useRecordingSessionsStore((state) => state.panelError);
  const recordingJobIds = useMemo(
    () => Object.values(sessionsByTabId)
      .filter((session) => session.status === "recording" && session.job?.id)
      .map((session) => session.job!.id),
    [sessionsByTabId],
  );
  const activeRecordingCount = useMemo(
    () => Object.values(sessionsByTabId).filter((session) => session.status === "recording").length,
    [sessionsByTabId],
  );
  const hasLiveRecording = activeRecordingCount > 0;

  const uiSession = useMemo(
    () => selectUiSession(focusedTabId, sessionsByTabId),
    [focusedTabId, sessionsByTabId],
  );
  const state = useMemo(() => toApplicationRecordingState(uiSession), [uiSession]);
  const stateRef = useRef(state);
  stateRef.current = state;
  const uiTabIdRef = useRef<number | null>(uiSession?.tabId ?? null);
  uiTabIdRef.current = uiSession?.tabId ?? null;

  useEffect(() => {
    const api = extensionApi();
    let cancelled = false;

    const syncFocus = async () => {
      const tabId = await queryActiveTabId();
      if (!cancelled && tabId != null) {
        const current = useRecordingSessionsStore.getState().focusedTabId;
        if (current !== tabId) {
          useRecordingSessionsStore.getState().setFocusedTabId(tabId);
        }
      }
    };

    void syncFocus();
    void listLiveSessions().then((sessions) => {
      if (cancelled) return;
      const store = useRecordingSessionsStore.getState();
      for (const live of sessions) {
        const existing = store.sessionsByTabId[live.tabId];
        if (existing?.status === "recording" || existing?.status === "review" || existing?.status === "saving") {
          continue;
        }
        store.replaceSession(live.tabId, createIdleSession(live.tabId, {
          status: "recording",
          job: live.job ? jobFromSnapshot(live.job) : null,
          sessionId: live.sessionId,
          elapsedSeconds: Math.max(0, Math.floor((Date.now() - live.startedAt) / 1000)),
          recordedStartAt: new Date(live.startedAt).toISOString(),
        }));
      }
    });

    const onActivated = (activeInfo: { tabId: number }) => {
      useRecordingSessionsStore.getState().setFocusedTabId(activeInfo.tabId);
    };
    const onRemoved = (tabId: number) => {
      useRecordingSessionsStore.getState().removeSession(tabId);
    };

    api?.tabs?.onActivated?.addListener?.(onActivated);
    api?.tabs?.onRemoved?.addListener?.(onRemoved);

    const onRecordingLifecycle = (message: {
      type?: string;
      tabId?: number | null;
      sessionId?: string | null;
      job?: JobSnapshot | null;
      startedAt?: number;
      error?: string | null;
    }) => {
      if (message?.type === "ATHENS_LENS_RECORDING_STARTED") {
        const tabId = typeof message.tabId === "number" ? message.tabId : null;
        const sessionId = String(message.sessionId || "");
        if (tabId == null || !sessionId) return;
        const store = useRecordingSessionsStore.getState();
        store.setPanelError(null);
        store.setFocusedTabId(tabId);
        store.replaceSession(tabId, createIdleSession(tabId, {
          status: "recording",
          job: message.job ? jobFromSnapshot(message.job) : null,
          sessionId,
          elapsedSeconds: Math.max(0, Math.floor((Date.now() - (message.startedAt || Date.now())) / 1000)),
          recordedStartAt: new Date(message.startedAt || Date.now()).toISOString(),
        }));
        return;
      }
      if (message?.type === "ATHENS_LENS_PENDING_RECORD_FAILED") {
        const error = String(message.error || "Could not start recording.");
        const store = useRecordingSessionsStore.getState();
        store.setPanelError(error);
        const tabId = typeof message.tabId === "number" ? message.tabId : store.focusedTabId;
        if (tabId != null) {
          store.patchSession(tabId, { error });
        }
      }
    };
    api?.runtime?.onMessage?.addListener?.(onRecordingLifecycle);

    const onResumeAudit = (message: {
      type?: string;
      tabId?: number | null;
      sessionId?: string | null;
      jobId?: string | null;
      originalName?: string | null;
      cleanedName?: string | null;
      expectedName?: string | null;
      renamed?: boolean;
    }) => {
      if (message?.type !== "ATHENS_LENS_RESUME_AUDIT") return;
      const store = useRecordingSessionsStore.getState();
      const originalName = String(message.originalName || "").trim();
      if (!originalName) return;

      let tabId = typeof message.tabId === "number" ? message.tabId : null;
      if (tabId == null && message.sessionId) {
        const match = Object.values(store.sessionsByTabId).find(
          (session) => session.sessionId === message.sessionId,
        );
        tabId = match?.tabId ?? null;
      }
      if (tabId == null && message.jobId) {
        const match = Object.values(store.sessionsByTabId).find(
          (session) => session.job?.id === message.jobId && session.status === "recording",
        );
        tabId = match?.tabId ?? null;
      }
      if (tabId == null) tabId = store.focusedTabId;
      if (tabId == null) return;

      store.patchSession(tabId, {
        resumeOriginalName: originalName,
        resumeCleanedName: String(message.cleanedName || "").trim() || null,
        resumeExpectedName: String(message.expectedName || "").trim() || null,
        resumeRenamed: Boolean(message.renamed),
      });
    };
    api?.runtime?.onMessage?.addListener?.(onResumeAudit);

    return () => {
      cancelled = true;
      api?.tabs?.onActivated?.removeListener?.(onActivated);
      api?.tabs?.onRemoved?.removeListener?.(onRemoved);
      api?.runtime?.onMessage?.removeListener?.(onRecordingLifecycle);
      api?.runtime?.onMessage?.removeListener?.(onResumeAudit);
    };
  }, []);

  useEffect(() => {
    if (!hasLiveRecording) return;
    const interval = window.setInterval(() => {
      useRecordingSessionsStore.getState().tickElapsed();
    }, 1000);
    return () => window.clearInterval(interval);
  }, [hasLiveRecording]);

  return {
    state,
    panelError,
    recordingJobIds,
    activeRecordingCount,
    async openApply(job: Job) {
      const store = useRecordingSessionsStore.getState();
      store.setPanelError(null);

      const applyUrl = normalizeApplyUrl(job.applyUrl);
      if (!applyUrl) {
        store.setPanelError("This job does not have an application link.");
        return;
      }

      const api = extensionApi();
      if (!api) {
        store.setPanelError("Opening apply links requires the Athens Lens Chrome extension.");
        return;
      }

      const opened = await openApplyTab(api, applyUrl);
      if (!opened.ok) {
        store.setPanelError(opened.error);
        return;
      }

      // Keep this job's detail open on the apply tab so Record stays tied to
      // the same role. Unrelated tabs still default to the jobs list.
      useTabWorkspaceStore.getState().setRoute(opened.tabId, {
        view: "jobs",
        itemId: job.id,
      });
      store.setFocusedTabId(opened.tabId);
    },

    async startRecording(job: Job, session: Session) {
      const store = useRecordingSessionsStore.getState();
      store.setPanelError(null);

      const api = extensionApi();
      if (!api?.runtime?.sendMessage) {
        store.setPanelError("Tab recording is only available in the Athens Lens Chrome extension.");
        return;
      }

      // Prefer the already-tracked focused tab so capture can start in this click turn.
      const tabId = store.focusedTabId;
      if (tabId == null) {
        store.setPanelError("Focus a normal web page tab, then click Record.");
        return;
      }

      const existing = store.sessionsByTabId[tabId];
      if (existing?.status === "recording") {
        const message = "This tab is already recording. Complete that bid first, or switch tabs.";
        store.setPanelError(message);
        store.patchSession(tabId, { error: message });
        return;
      }

      // Open the picker immediately in the button's user-gesture turn.
      const capturePromise = chooseTabCaptureStream(api);

      const applyUrl = normalizeApplyUrl(job.applyUrl) || job.applyUrl || "";
      const sessionId = createSessionId(job.id);
      const recordedStartAt = new Date().toISOString();

      const showStartError = (message: string) => {
        const next = useRecordingSessionsStore.getState();
        next.setPanelError(message);
        next.replaceSession(tabId, createIdleSession(tabId, { job, error: message }));
      };

      try {
        const activeTab = await queryActiveTab();
        if (activeTab?.id === tabId && activeTab.url && !isHttpTabUrl(activeTab.url)) {
          showStartError("Switch to a normal http(s) page (not New Tab), then click Record.");
          return;
        }

        const captured = await capturePromise;
        if (!captured.ok) {
          showStartError(friendlyCaptureError(captured.error));
          return;
        }

        void startAthensLensBid(session, {
          jobId: job.id,
          sessionId,
          applyUrl: applyUrl || undefined,
        }).catch((error: unknown) => {
          console.warn("Athens Lens: bid start failed", error);
        });

        const response = await sendStartRecording(api, applyUrl, sessionId, job, session, {
          tabId,
          streamId: captured.streamId,
          captureSource: captured.captureSource,
        });
        if (!response?.ok) {
          showStartError(response?.error || "Could not start tab recording.");
          return;
        }

        const nextStore = useRecordingSessionsStore.getState();
        nextStore.setPanelError(null);
        nextStore.setFocusedTabId(response.tabId);
        nextStore.replaceSession(response.tabId, createIdleSession(response.tabId, {
          status: "recording",
          job,
          sessionId,
          elapsedSeconds: 0,
          restartCount: 0,
          recordedStartAt,
        }));
      } catch (error) {
        showStartError(
          error instanceof Error ? error.message : "Could not start tab recording.",
        );
      }
    },

    async restart(session: Session) {
      const current = stateRef.current;
      const tabId = current.tabId ?? uiTabIdRef.current;
      if (!current.job || tabId == null) return;

      const api = extensionApi();
      if (!api?.runtime?.sendMessage) return;

      if (current.sessionId) {
        try {
          await stopTabRecording(current.sessionId);
        } catch {
          // Best-effort stop before restarting.
        }
      }

      // Ask the user which tab to capture again in this click turn.
      const capturePromise = chooseTabCaptureStream(api);
      const applyUrl = normalizeApplyUrl(current.job.applyUrl) || current.job.applyUrl || "";
      const sessionId = createSessionId(current.job.id);
      const recordedStartAt = new Date().toISOString();
      const restartCount = current.restartCount + 1;
      useRecordingSessionsStore.getState().replaceSession(tabId, createIdleSession(tabId, {
        status: "recording",
        job: current.job,
        sessionId,
        restartCount,
        recordedStartAt,
      }));

      try {
        const captured = await capturePromise;
        if (!captured.ok) {
          const message = friendlyCaptureError(captured.error);
          useRecordingSessionsStore.getState().replaceSession(
            tabId,
            createIdleSession(tabId, {
              job: current.job,
              restartCount,
              error: message,
            }),
          );
          useRecordingSessionsStore.getState().setPanelError(message);
          return;
        }

        void startAthensLensBid(session, {
          jobId: current.job.id,
          sessionId,
          applyUrl: applyUrl || undefined,
        }).catch((error: unknown) => {
          console.warn("Athens Lens: bid restart start failed", error);
        });

        const response = await sendStartRecording(
          api,
          applyUrl,
          sessionId,
          current.job,
          session,
          {
            tabId,
            streamId: captured.streamId,
            captureSource: captured.captureSource,
          },
        );
        if (!response?.ok) {
          useRecordingSessionsStore.getState().replaceSession(
            tabId,
            createIdleSession(tabId, {
              job: current.job,
              restartCount,
              error: response?.error || "Could not restart tab recording.",
            }),
          );
          return;
        }
        useRecordingSessionsStore.getState().setFocusedTabId(response.tabId);
        useRecordingSessionsStore.getState().replaceSession(
          response.tabId,
          createIdleSession(response.tabId, {
            status: "recording",
            job: current.job,
            sessionId,
            restartCount,
            recordedStartAt,
          }),
        );
      } catch (error) {
        useRecordingSessionsStore.getState().replaceSession(
          tabId,
          createIdleSession(tabId, {
            job: current.job,
            restartCount,
            error: error instanceof Error ? error.message : "Could not restart tab recording.",
          }),
        );
      }
    },

    async complete() {
      const current = stateRef.current;
      const tabId = current.tabId ?? uiTabIdRef.current;
      if (!current.job || !current.sessionId || tabId == null) return;

      try {
        const response = await stopTabRecording(current.sessionId);
        const recordedEndAt = new Date().toISOString();
        useRecordingSessionsStore.getState().replaceSession(tabId, {
          ...createIdleSession(tabId),
          ...current,
          tabId,
          status: "review",
          recordedEndAt,
          error: response?.ok ? null : (response?.error || "Recording stopped, but the file could not be saved."),
          savedFilename: response?.ok ? (response.filename || null) : current.savedFilename,
        });
      } catch (error) {
        useRecordingSessionsStore.getState().patchSession(tabId, {
          status: "review",
          recordedEndAt: new Date().toISOString(),
          error: error instanceof Error ? error.message : "Could not finish the recording.",
        });
      }
    },
    resume() {
      const tabId = uiTabIdRef.current;
      if (tabId == null) return;
      useRecordingSessionsStore.getState().patchSession(tabId, {
        status: "recording",
        error: null,
      });
    },
    async finish(submitted: boolean, context: FinishBidContext) {
      const current = stateRef.current;
      const tabId = current.tabId ?? uiTabIdRef.current;
      if (!current.job || tabId == null) {
        if (tabId != null) {
          useRecordingSessionsStore.getState().replaceSession(
            tabId,
            createIdleSession(tabId, submitted ? { lastOutcome: "submitted" } : {}),
          );
        }
        return;
      }

      const jobId = current.job.id;
      const store = useRecordingSessionsStore.getState();

      // Gather every tab session for this job so multi-tab Workday clips upload together.
      const related = Object.values(store.sessionsByTabId).filter(
        (session) => session.job?.id === jobId && session.sessionId,
      );

      for (const session of related) {
        if (session.status === "recording" && session.sessionId) {
          try {
            const stopped = await stopTabRecording(session.sessionId);
            const recordedEndAt = new Date().toISOString();
            useRecordingSessionsStore.getState().replaceSession(session.tabId, {
              ...session,
              status: "review",
              recordedEndAt,
              error: stopped?.ok ? null : (stopped?.error || session.error),
              savedFilename: stopped?.ok
                ? (stopped.filename || session.savedFilename)
                : session.savedFilename,
            });
          } catch {
            // Best-effort stop.
          }
        }
      }

      const freshRelated = Object.values(useRecordingSessionsStore.getState().sessionsByTabId)
        .filter((session) => session.job?.id === jobId && session.sessionId);
      const recordingSessions = freshRelated.map((session) => ({
        recordingSessionId: session.sessionId!,
        durationSec: session.elapsedSeconds,
        recordedStartAt: session.recordedStartAt,
        recordedEndAt: session.recordedEndAt || new Date().toISOString(),
      }));

      // "No, not submitted" — discard local clips and clear UI only (no Athens API).
      if (!submitted) {
        try {
          await finishAthensLensBid({
            session: context.session,
            jobId,
            recordingSessions,
            submitted: false,
          });
        } catch {
          // Local discard is best-effort.
        }
        const nextStore = useRecordingSessionsStore.getState();
        for (const session of freshRelated) {
          nextStore.replaceSession(session.tabId, createIdleSession(session.tabId));
        }
        if (!freshRelated.some((session) => session.tabId === tabId)) {
          nextStore.replaceSession(tabId, createIdleSession(tabId));
        }
        return;
      }

      store.patchSession(tabId, {
        status: "saving",
        error: null,
      });
      for (const session of freshRelated) {
        if (session.tabId !== tabId) {
          useRecordingSessionsStore.getState().patchSession(session.tabId, {
            status: "saving",
            error: null,
          });
        }
      }

      try {
        const result = await finishAthensLensBid({
          session: context.session,
          jobId,
          applyUrl: current.job.applyUrl,
          recordingSessions,
          submitted: true,
          answers: context.answers,
          summary: context.summary,
          pageContext: context.pageContext,
          mode: context.mode,
        });

        const nextStore = useRecordingSessionsStore.getState();
        for (const session of freshRelated) {
          nextStore.replaceSession(
            session.tabId,
            createIdleSession(session.tabId, {
              lastOutcome: "submitted",
              job: current.job,
              error: session.tabId === tabId ? (result.uploadError || null) : null,
            }),
          );
        }
      } catch (error) {
        useRecordingSessionsStore.getState().patchSession(tabId, {
          status: "review",
          error: error instanceof Error ? error.message : "Could not save this bid to Athens.",
        });
      }
    },
    clearOutcome() {
      const tabId = uiTabIdRef.current ?? stateRef.current.tabId;
      useRecordingSessionsStore.getState().setPanelError(null);
      if (tabId == null) return;
      useRecordingSessionsStore.getState().removeSession(tabId);
    },
    clearPanelError() {
      useRecordingSessionsStore.getState().setPanelError(null);
    },
    reset() {
      const store = useRecordingSessionsStore.getState();
      for (const session of Object.values(store.sessionsByTabId)) {
        if (session.sessionId) {
          void stopTabRecording(session.sessionId).catch(() => undefined);
        }
      }
      store.clearAll();
    },
  };
}

export function formatRecordingTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
