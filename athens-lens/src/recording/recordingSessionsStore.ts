import { create } from "zustand";
import type { Job } from "../types";

export type RecordingStatus = "idle" | "recording" | "review" | "saving";

export interface TabRecordingSession {
  status: RecordingStatus;
  job: Job | null;
  sessionId: string | null;
  tabId: number;
  elapsedSeconds: number;
  restartCount: number;
  lastOutcome: "submitted" | "not-submitted" | null;
  error: string | null;
  savedFilename: string | null;
  recordedStartAt: string | null;
  recordedEndAt: string | null;
  /** Local resume filename before ATS rename. */
  resumeOriginalName: string | null;
  /** Filename actually submitted to the ATS (profile name + original ext). */
  resumeCleanedName: string | null;
  resumeExpectedName: string | null;
  resumeRenamed: boolean;
}

export function createIdleSession(tabId: number, overrides: Partial<TabRecordingSession> = {}): TabRecordingSession {
  return {
    status: "idle",
    job: null,
    sessionId: null,
    tabId,
    elapsedSeconds: 0,
    restartCount: 0,
    lastOutcome: null,
    error: null,
    savedFilename: null,
    recordedStartAt: null,
    recordedEndAt: null,
    resumeOriginalName: null,
    resumeCleanedName: null,
    resumeExpectedName: null,
    resumeRenamed: false,
    ...overrides,
  };
}

interface RecordingSessionsState {
  /** Browser tab the side panel is currently targeting. */
  focusedTabId: number | null;
  /** Live / review / saving sessions keyed by capture tab id. */
  sessionsByTabId: Record<number, TabRecordingSession>;
  /** Apply/start errors that must show even when no tab session exists. */
  panelError: string | null;
  setFocusedTabId(tabId: number | null): void;
  setPanelError(message: string | null): void;
  replaceSession(tabId: number, session: TabRecordingSession): void;
  patchSession(tabId: number, patch: Partial<TabRecordingSession>): void;
  removeSession(tabId: number): void;
  clearAll(): void;
  tickElapsed(): void;
}

export const useRecordingSessionsStore = create<RecordingSessionsState>((set, get) => ({
  focusedTabId: null,
  sessionsByTabId: {},
  panelError: null,

  setFocusedTabId(tabId) {
    set({ focusedTabId: tabId });
  },

  setPanelError(message) {
    set({ panelError: message });
  },

  replaceSession(tabId, session) {
    set((state) => ({
      sessionsByTabId: {
        ...state.sessionsByTabId,
        [tabId]: { ...session, tabId },
      },
      panelError: session.error && session.status === "idle" ? null : state.panelError,
    }));
  },

  patchSession(tabId, patch) {
    const current = get().sessionsByTabId[tabId] ?? createIdleSession(tabId);
    set((state) => ({
      sessionsByTabId: {
        ...state.sessionsByTabId,
        [tabId]: { ...current, ...patch, tabId },
      },
    }));
  },

  removeSession(tabId) {
    set((state) => {
      if (!state.sessionsByTabId[tabId]) return state;
      const next = { ...state.sessionsByTabId };
      delete next[tabId];
      return { sessionsByTabId: next };
    });
  },

  clearAll() {
    set({ sessionsByTabId: {}, focusedTabId: null, panelError: null });
  },

  tickElapsed() {
    const { sessionsByTabId } = get();
    let changed = false;
    const next: Record<number, TabRecordingSession> = { ...sessionsByTabId };
    for (const [key, session] of Object.entries(sessionsByTabId)) {
      if (session.status !== "recording") continue;
      const tabId = Number(key);
      next[tabId] = { ...session, elapsedSeconds: session.elapsedSeconds + 1 };
      changed = true;
    }
    if (changed) set({ sessionsByTabId: next });
  },
}));

export function selectFocusedSession(state: RecordingSessionsState): TabRecordingSession | null {
  const tabId = state.focusedTabId;
  if (tabId == null) return null;
  return state.sessionsByTabId[tabId] ?? null;
}

export function selectRecordingJobIds(state: RecordingSessionsState): string[] {
  return Object.values(state.sessionsByTabId)
    .filter((session) => session.status === "recording" && session.job?.id)
    .map((session) => session.job!.id);
}

/** Compatible shape for existing RecordingDock / dialog components. */
export type ApplicationRecordingState = Omit<TabRecordingSession, "tabId"> & {
  tabId: number | null;
};

export function toApplicationRecordingState(
  session: TabRecordingSession | null,
): ApplicationRecordingState {
  if (!session) {
    return {
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
      resumeOriginalName: null,
      resumeCleanedName: null,
      resumeExpectedName: null,
      resumeRenamed: false,
    };
  }
  return session;
}
