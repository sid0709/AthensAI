import { describe, expect, it } from "vitest";
import { createCaptureReadyTracker, isCapturableTabUrl } from "./captureReadyTabs";

describe("captureReadyTabs", () => {
  it("only marks http(s) tabs as capture-ready", () => {
    const tracker = createCaptureReadyTracker();
    expect(tracker.remember(1, "chrome://newtab/")).toBe(false);
    expect(tracker.remember(2, "brave://newtab/")).toBe(false);
    expect(tracker.remember(3, "https://jobs.example.com/apply")).toBe(true);
    expect(tracker.remember(4, "")).toBe(true);
    expect(tracker.has(1)).toBe(false);
    expect(tracker.has(3)).toBe(true);
    expect(isCapturableTabUrl("http://localhost:3000")).toBe(true);
  });

  it("resolves preferred ready tab, then last invoked, then any ready tab", () => {
    const tracker = createCaptureReadyTracker();
    tracker.remember(10, "https://a.example");
    tracker.remember(20, "https://b.example");
    expect(tracker.resolve(20)).toBe(20);
    expect(tracker.resolve(99)).toBe(20);
    tracker.forget(20);
    expect(tracker.resolve(null)).toBe(10);
  });

  it("restores capture-ready tabs after a service-worker restart snapshot", () => {
    const tracker = createCaptureReadyTracker();
    tracker.remember(7, "https://jobs.example.com");
    const snap = tracker.snapshot();
    const revived = createCaptureReadyTracker();
    revived.restore(snap);
    expect(revived.resolve(null)).toBe(7);
  });
});
