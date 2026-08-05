import { useEffect, useRef, useState } from "react";
import type { Job, Session } from "../types";
import type { FormAnswer, PageContext } from "./askAi";
import { finishAthensLensBid, startAthensLensBid } from "./bidPersist";

export type RecordingStatus = "idle" | "recording" | "review" | "saving";

export interface ApplicationRecordingState {
  status: RecordingStatus;
  job: Job | null;
  sessionId: string | null;
  tabId: number | null;
  elapsedSeconds: number;
  restartCount: number;
  lastOutcome: "submitted" | "not-submitted" | null;
  error: string | null;
  savedFilename: string | null;
  recordedStartAt: string | null;
  recordedEndAt: string | null;
}

const INITIAL_STATE: ApplicationRecordingState = {
  status: "idle",
  job: null,
  sessionId: null,
  tabId: null,
  elapsedSeconds: 0,
  restartCount: 0,
  lastOutcome: null,
  error: null,
  savedFilename: null,
  recordedStartAt: null,
  recordedEndAt: null,
};

type StartResponse =
  | { ok: true; tabId: number }
  | { ok: false; tabId?: number; error?: string };

type StopResponse =
  | { ok: true; tabId: number | null; filename?: string; mimeType?: string; byteLength?: number }
  | { ok: false; tabId?: number | null; error?: string };

function extensionApi() {
  const root = globalThis as typeof globalThis & {
    chrome?: typeof chrome;
    browser?: typeof chrome;
  };
  return root.chrome ?? root.browser ?? null;
}

/**
 * Send the start request immediately from the click turn so Chrome preserves
 * the user gesture for tabCapture in the service worker. The worker captures
 * the tab Athens Lens was opened on, then navigates it to the apply URL.
 */
function startTabRecording(applyUrl: string, sessionId: string): Promise<StartResponse> {
  const api = extensionApi();
  if (!api?.runtime?.sendMessage) {
    return Promise.resolve({
      ok: false,
      error: "Tab recording is only available in the Athens Lens Chrome extension.",
    });
  }

  try {
    return Promise.resolve(
      api.runtime.sendMessage({
        type: "ATHENS_LENS_START_RECORDING",
        applyUrl,
        sessionId,
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

function createSessionId(jobId: string) {
  return `lens-${jobId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface FinishBidContext {
  session: Session;
  answers?: FormAnswer[];
  summary?: string;
  pageContext?: PageContext | null;
  mode?: string;
}

export function useApplicationRecording() {
  const [state, setState] = useState<ApplicationRecordingState>(INITIAL_STATE);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (state.status !== "recording") return;
    const interval = window.setInterval(() => {
      setState((current) => ({ ...current, elapsedSeconds: current.elapsedSeconds + 1 }));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [state.status]);

  return {
    state,
    async start(job: Job, session: Session) {
      if (!job.applyUrl) {
        setState({
          ...INITIAL_STATE,
          job,
          error: "This job does not have an application link to record.",
        });
        return;
      }

      const sessionId = createSessionId(job.id);
      const recordedStartAt = new Date().toISOString();
      setState({
        status: "recording",
        job,
        sessionId,
        tabId: null,
        elapsedSeconds: 0,
        restartCount: 0,
        lastOutcome: null,
        error: null,
        savedFilename: null,
        recordedStartAt,
        recordedEndAt: null,
      });

      try {
        void startAthensLensBid(session, {
          jobId: job.id,
          sessionId,
          applyUrl: job.applyUrl,
        }).catch((error: unknown) => {
          console.warn("Athens Lens: bid start failed", error);
        });

        const response = await startTabRecording(job.applyUrl, sessionId);
        if (!response?.ok) {
          setState({
            ...INITIAL_STATE,
            job,
            tabId: response?.tabId ?? null,
            error: response?.error || "Could not start tab recording.",
          });
          return;
        }

        setState((current) => current.sessionId === sessionId
          ? { ...current, tabId: response.tabId, error: null }
          : current);
      } catch (error) {
        setState({
          ...INITIAL_STATE,
          job,
          error: error instanceof Error ? error.message : "Could not start tab recording.",
        });
      }
    },
    async restart(session: Session) {
      const current = stateRef.current;
      if (!current.job?.applyUrl) return;
      if (current.sessionId) {
        try {
          await stopTabRecording(current.sessionId);
        } catch {
          // Best-effort stop before restarting.
        }
      }
      const sessionId = createSessionId(current.job.id);
      const recordedStartAt = new Date().toISOString();
      setState({
        ...current,
        status: "recording",
        sessionId,
        tabId: null,
        elapsedSeconds: 0,
        restartCount: current.restartCount + 1,
        error: null,
        savedFilename: null,
        lastOutcome: null,
        recordedStartAt,
        recordedEndAt: null,
      });
      try {
        void startAthensLensBid(session, {
          jobId: current.job.id,
          sessionId,
          applyUrl: current.job.applyUrl,
        }).catch((error: unknown) => {
          console.warn("Athens Lens: bid restart start failed", error);
        });
        const response = await startTabRecording(current.job.applyUrl, sessionId);
        if (!response?.ok) {
          setState({
            ...INITIAL_STATE,
            job: current.job,
            tabId: response?.tabId ?? null,
            restartCount: current.restartCount + 1,
            error: response?.error || "Could not restart tab recording.",
          });
          return;
        }
        setState((next) => next.sessionId === sessionId
          ? { ...next, tabId: response.tabId, error: null }
          : next);
      } catch (error) {
        setState({
          ...INITIAL_STATE,
          job: current.job,
          restartCount: current.restartCount + 1,
          error: error instanceof Error ? error.message : "Could not restart tab recording.",
        });
      }
    },
    async complete() {
      const current = stateRef.current;
      if (!current.job || !current.sessionId) return;
      try {
        const response = await stopTabRecording(current.sessionId);
        const recordedEndAt = new Date().toISOString();
        if (!response?.ok) {
          setState({
            ...current,
            status: "review",
            recordedEndAt,
            error: response?.error || "Recording stopped, but the file could not be saved.",
          });
          return;
        }
        setState({
          ...current,
          status: "review",
          // Keep sessionId so submit can upload the pending offscreen blob.
          error: null,
          savedFilename: response.filename || null,
          recordedEndAt,
        });
      } catch (error) {
        setState({
          ...current,
          status: "review",
          recordedEndAt: new Date().toISOString(),
          error: error instanceof Error ? error.message : "Could not finish the recording.",
        });
      }
    },
    resume() {
      setState((current) => current.job
        ? { ...current, status: "recording", error: null }
        : current);
    },
    async finish(submitted: boolean, context: FinishBidContext) {
      const current = stateRef.current;
      if (!current.job) {
        setState({
          ...INITIAL_STATE,
          lastOutcome: submitted ? "submitted" : "not-submitted",
        });
        return;
      }

      setState({
        ...current,
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

        setState({
          ...INITIAL_STATE,
          lastOutcome: submitted ? "submitted" : "not-submitted",
          job: current.job,
          error: result.uploadError || null,
        });
      } catch (error) {
        setState({
          ...current,
          status: "review",
          error: error instanceof Error ? error.message : "Could not save this bid to Athens.",
        });
      }
    },
    clearOutcome() {
      setState((current) => ({ ...current, job: null, lastOutcome: null, error: null }));
    },
    reset() {
      const current = stateRef.current;
      if (current.sessionId) {
        void stopTabRecording(current.sessionId).catch(() => undefined);
      }
      setState(INITIAL_STATE);
    },
  };
}

export function formatRecordingTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
