import { useEffect, useState } from "react";
import type { Job } from "../types";

export type RecordingStatus = "idle" | "recording" | "review";

export interface MockRecordingState {
  status: RecordingStatus;
  job: Job | null;
  elapsedSeconds: number;
  restartCount: number;
  lastOutcome: "submitted" | "not-submitted" | null;
}

const INITIAL_STATE: MockRecordingState = {
  status: "idle",
  job: null,
  elapsedSeconds: 0,
  restartCount: 0,
  lastOutcome: null
};

export function useMockRecording() {
  const [state, setState] = useState<MockRecordingState>(INITIAL_STATE);

  useEffect(() => {
    if (state.status !== "recording") return;

    const interval = window.setInterval(() => {
      setState((current) => ({ ...current, elapsedSeconds: current.elapsedSeconds + 1 }));
    }, 1000);

    return () => window.clearInterval(interval);
  }, [state.status]);

  return {
    state,
    start(job: Job) {
      setState({
        status: "recording",
        job,
        elapsedSeconds: 0,
        restartCount: 0,
        lastOutcome: null
      });
    },
    restart() {
      setState((current) => current.job ? {
        ...current,
        status: "recording",
        elapsedSeconds: 0,
        restartCount: current.restartCount + 1
      } : current);
    },
    complete() {
      setState((current) => current.job ? { ...current, status: "review" } : current);
    },
    resume() {
      setState((current) => current.job ? { ...current, status: "recording" } : current);
    },
    finish(submitted: boolean) {
      setState((current) => ({
        ...INITIAL_STATE,
        lastOutcome: submitted ? "submitted" : "not-submitted",
        job: current.job
      }));
    },
    clearOutcome() {
      setState((current) => ({ ...current, job: null, lastOutcome: null }));
    },
    reset() {
      setState(INITIAL_STATE);
    }
  };
}

export function formatRecordingTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
