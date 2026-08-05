import { useEffect, useRef, useState } from "react";
import type { Job } from "../types";

export type RecordingStatus = "idle" | "recording" | "review";

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

function runtimeLastErrorMessage(api: NonNullable<ReturnType<typeof extensionApi>>) {
  return api.runtime?.lastError?.message || null;
}

/**
 * Open the apply URL and obtain a tab-capture stream ID in the same user-gesture
 * callback chain, then hand the stream to the background/offscreen recorder.
 */
function startTabRecording(applyUrl: string, sessionId: string): Promise<StartResponse> {
  const api = extensionApi();
  if (!api?.tabs?.create || !api.tabCapture?.getMediaStreamId || !api.runtime?.sendMessage) {
    return Promise.resolve({
      ok: false,
      error: "Tab recording is only available in the Athens Lens Chrome extension.",
    });
  }

  return new Promise((resolve) => {
    api.tabs.create({ url: applyUrl, active: true }, (tab) => {
      const createError = runtimeLastErrorMessage(api);
      if (createError || tab?.id == null) {
        resolve({ ok: false, error: createError || "Could not open the application page." });
        return;
      }

      const tabId = tab.id;
      api.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId) => {
        const captureError = runtimeLastErrorMessage(api);
        if (captureError || !streamId) {
          resolve({
            ok: false,
            tabId,
            error: captureError || "Could not capture the application tab.",
          });
          return;
        }

        try {
          const pending = api.runtime.sendMessage({
            type: "ATHENS_LENS_START_RECORDING",
            sessionId,
            tabId,
            streamId,
          }) as Promise<StartResponse | undefined>;

          void Promise.resolve(pending)
            .then((response) => {
              if (response?.ok) {
                resolve({ ok: true, tabId: response.tabId ?? tabId });
                return;
              }
              resolve({
                ok: false,
                tabId,
                error: response?.error || "Could not start the recorder.",
              });
            })
            .catch((error: unknown) => {
              resolve({
                ok: false,
                tabId,
                error: error instanceof Error ? error.message : "Could not start the recorder.",
              });
            });
        } catch (error) {
          resolve({
            ok: false,
            tabId,
            error: error instanceof Error ? error.message : "Could not start the recorder.",
          });
        }
      });
    });
  });
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
    async start(job: Job) {
      if (!job.applyUrl) {
        setState({
          ...INITIAL_STATE,
          job,
          error: "This job does not have an application link to record.",
        });
        return;
      }

      const sessionId = createSessionId(job.id);
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
      });

      try {
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
    async restart() {
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
      });
      try {
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
        if (!response?.ok) {
          setState({
            ...current,
            status: "review",
            error: response?.error || "Recording stopped, but the file could not be saved.",
          });
          return;
        }
        setState({
          ...current,
          status: "review",
          sessionId: null,
          error: null,
          savedFilename: response.filename || null,
        });
      } catch (error) {
        setState({
          ...current,
          status: "review",
          error: error instanceof Error ? error.message : "Could not finish the recording.",
        });
      }
    },
    resume() {
      setState((current) => current.job
        ? { ...current, status: "recording", error: null }
        : current);
    },
    finish(submitted: boolean) {
      setState((current) => ({
        ...INITIAL_STATE,
        lastOutcome: submitted ? "submitted" : "not-submitted",
        job: current.job,
      }));
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
