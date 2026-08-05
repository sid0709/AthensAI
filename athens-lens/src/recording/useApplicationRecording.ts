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

/**
 * Send the start request immediately from the click turn so Chrome preserves
 * the user gesture for tabCapture in the service worker. The worker captures
 * the preferred (or last invoked) capture-ready tab, then navigates it.
 */
function startTabRecording(
  applyUrl: string,
  sessionId: string,
  preferredTabId: number | null,
  job: Job,
  session: Session,
): Promise<StartResponse> {
  const api = extensionApi();
  if (!api?.runtime?.sendMessage) {
    return Promise.resolve({
      ok: false,
      error: "Tab recording is only available in the Athens Lens Chrome extension.",
    });
  }

  const bidderName = session.displayName || session.username;
  const expectedResumeName = buildProfileResumeFileName(bidderName, ".pdf");
  const resumeSetFolder = profileNameToFileBase(bidderName) || "";

  try {
    return Promise.resolve(
      api.runtime.sendMessage({
        type: "ATHENS_LENS_START_RECORDING",
        applyUrl,
        sessionId,
        preferredTabId,
        job: jobSnapshot(job),
        expectedResumeName,
        resumeSetFolder,
        bidderName,
      }) as Promise<StartResponse | undefined>,
    ).then((response) => {
      if (response?.ok && response.tabId != null) {
        return { ok: true as const, tabId: response.tabId };
      }
      return {
        ok: false as const,
        tabId: response && "tabId" in response ? response.tabId : undefined,
        error: (!response?.ok && response?.error) || "Could not start the recorder.",
      };
    }).catch((error: unknown) => ({
      ok: false as const,
      error: error instanceof Error ? error.message : "Could not start the recorder.",
    }));
  } catch (error) {
    return Promise.resolve({
      ok: false,
      error: error instanceof Error ? error.message : "Could not start the recorder.",
    });
  }
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

async function queryActiveTabId(): Promise<number | null> {
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
    const tabId = tabs[0]?.id;
    return typeof tabId === "number" ? tabId : null;
  } catch {
    return null;
  }
}

function createSessionId(jobId: string) {
  return `lens-${jobId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function selectUiSession(
  focusedTabId: number | null,
  sessionsByTabId: Record<number, TabRecordingSession>,
): TabRecordingSession | null {
  const sessions = Object.values(sessionsByTabId);
  const review = sessions.find((session) => session.status === "review" || session.status === "saving");
  if (review) return review;

  if (focusedTabId != null && sessionsByTabId[focusedTabId]) {
    return sessionsByTabId[focusedTabId]!;
  }

  const recording = sessions.find((session) => session.status === "recording");
  if (recording) return recording;

  return sessions.find((session) => session.lastOutcome || session.error) ?? null;
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
    recordingJobIds,
    activeRecordingCount,
    async start(job: Job, session: Session) {
      if (!job.applyUrl) {
        const store = useRecordingSessionsStore.getState();
        const tabId = store.focusedTabId ?? (await queryActiveTabId());
        if (tabId != null) {
          store.replaceSession(tabId, createIdleSession(tabId, {
            job,
            error: "This job does not have an application link to record.",
          }));
          store.setFocusedTabId(tabId);
        }
        return;
      }

      const store = useRecordingSessionsStore.getState();
      const preferredTabId = store.focusedTabId ?? (await queryActiveTabId());
      if (preferredTabId != null) {
        const existing = store.sessionsByTabId[preferredTabId];
        if (existing?.status === "recording") {
          store.patchSession(preferredTabId, {
            error: "This tab is already recording. Complete that bid first, or switch to another capture-ready tab.",
          });
          return;
        }
      }

      const sessionId = createSessionId(job.id);
      const recordedStartAt = new Date().toISOString();

      try {
        void startAthensLensBid(session, {
          jobId: job.id,
          sessionId,
          applyUrl: job.applyUrl,
        }).catch((error: unknown) => {
          console.warn("Athens Lens: bid start failed", error);
        });

        const response = await startTabRecording(job.applyUrl, sessionId, preferredTabId, job, session);
        if (!response?.ok) {
          const errorTabId = response?.tabId ?? preferredTabId;
          if (errorTabId != null) {
            useRecordingSessionsStore.getState().replaceSession(
              errorTabId,
              createIdleSession(errorTabId, {
                job,
                error: response?.error || "Could not start tab recording.",
              }),
            );
            useRecordingSessionsStore.getState().setFocusedTabId(errorTabId);
          }
          return;
        }

        const nextStore = useRecordingSessionsStore.getState();
        if (preferredTabId != null && preferredTabId !== response.tabId) {
          nextStore.removeSession(preferredTabId);
        }
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
        const errorTabId = preferredTabId;
        if (errorTabId != null) {
          useRecordingSessionsStore.getState().replaceSession(
            errorTabId,
            createIdleSession(errorTabId, {
              job,
              error: error instanceof Error ? error.message : "Could not start tab recording.",
            }),
          );
        }
      }
    },
    async restart(session: Session) {
      const current = stateRef.current;
      const tabId = current.tabId ?? uiTabIdRef.current;
      if (!current.job?.applyUrl || tabId == null) return;

      if (current.sessionId) {
        try {
          await stopTabRecording(current.sessionId);
        } catch {
          // Best-effort stop before restarting.
        }
      }

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
        void startAthensLensBid(session, {
          jobId: current.job.id,
          sessionId,
          applyUrl: current.job.applyUrl,
        }).catch((error: unknown) => {
          console.warn("Athens Lens: bid restart start failed", error);
        });
        const response = await startTabRecording(
          current.job.applyUrl,
          sessionId,
          tabId,
          current.job,
          session,
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
        if (response.tabId !== tabId) {
          useRecordingSessionsStore.getState().removeSession(tabId);
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
            createIdleSession(tabId, {
              lastOutcome: submitted ? "submitted" : "not-submitted",
            }),
          );
        }
        return;
      }

      useRecordingSessionsStore.getState().patchSession(tabId, {
        status: "saving",
        error: null,
      });

      try {
        const result = await finishAthensLensBid({
          session: context.session,
          jobId: current.job.id,
          applyUrl: current.job.applyUrl,
          recordingSessionId: current.sessionId,
          durationSec: current.elapsedSeconds,
          recordedStartAt: current.recordedStartAt,
          recordedEndAt: current.recordedEndAt || new Date().toISOString(),
          submitted,
          answers: context.answers,
          summary: context.summary,
          pageContext: context.pageContext,
          mode: context.mode,
        });

        useRecordingSessionsStore.getState().replaceSession(
          tabId,
          createIdleSession(tabId, {
            lastOutcome: submitted ? "submitted" : "not-submitted",
            job: current.job,
            error: result.uploadError || null,
          }),
        );
      } catch (error) {
        useRecordingSessionsStore.getState().patchSession(tabId, {
          status: "review",
          error: error instanceof Error ? error.message : "Could not save this bid to Athens.",
        });
      }
    },
    clearOutcome() {
      const tabId = uiTabIdRef.current ?? stateRef.current.tabId;
      if (tabId == null) return;
      useRecordingSessionsStore.getState().removeSession(tabId);
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
