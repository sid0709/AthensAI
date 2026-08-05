import { beforeEach, describe, expect, it } from "vitest";
import {
  createIdleSession,
  selectFocusedSession,
  selectRecordingJobIds,
  useRecordingSessionsStore,
} from "./recordingSessionsStore";
import type { Job } from "../types";

const jobA = {
  id: "job-a",
  title: "Role A",
  company: "Company A",
  applyUrl: "https://example.com/a",
} as Job;

const jobB = {
  id: "job-b",
  title: "Role B",
  company: "Company B",
  applyUrl: "https://example.com/b",
} as Job;

describe("recordingSessionsStore", () => {
  beforeEach(() => {
    useRecordingSessionsStore.getState().clearAll();
  });

  it("keeps independent sessions per browser tab", () => {
    const store = useRecordingSessionsStore.getState();
    store.replaceSession(10, createIdleSession(10, {
      status: "recording",
      job: jobA,
      sessionId: "lens-a",
      elapsedSeconds: 3,
    }));
    store.replaceSession(20, createIdleSession(20, {
      status: "recording",
      job: jobB,
      sessionId: "lens-b",
      elapsedSeconds: 8,
    }));
    store.setFocusedTabId(10);

    expect(selectRecordingJobIds(useRecordingSessionsStore.getState())).toEqual(["job-a", "job-b"]);
    expect(selectFocusedSession(useRecordingSessionsStore.getState())?.job?.id).toBe("job-a");

    store.setFocusedTabId(20);
    expect(selectFocusedSession(useRecordingSessionsStore.getState())?.job?.id).toBe("job-b");
    expect(useRecordingSessionsStore.getState().sessionsByTabId[10]?.elapsedSeconds).toBe(3);
  });

  it("ticks elapsed time for every live recording session", () => {
    const store = useRecordingSessionsStore.getState();
    store.replaceSession(10, createIdleSession(10, { status: "recording", job: jobA, elapsedSeconds: 1 }));
    store.replaceSession(20, createIdleSession(20, { status: "review", job: jobB, elapsedSeconds: 9 }));
    store.tickElapsed();

    expect(useRecordingSessionsStore.getState().sessionsByTabId[10]?.elapsedSeconds).toBe(2);
    expect(useRecordingSessionsStore.getState().sessionsByTabId[20]?.elapsedSeconds).toBe(9);
  });
});
