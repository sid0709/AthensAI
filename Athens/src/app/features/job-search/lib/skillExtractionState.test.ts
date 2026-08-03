import test from "node:test";
import assert from "node:assert/strict";
import type { BackgroundTask } from "@/app/api/backgroundTasks";
import { skillExtractionSessionFromTask } from "./skillExtractionState";

function task(overrides: Partial<BackgroundTask> = {}): BackgroundTask {
  return {
    id: "task-1",
    type: "skill_extraction",
    status: "queued",
    profileId: "profile-1",
    applierName: "Robin",
    progress: { total: null, completed: 0, active: 0 },
    createdAt: "2026-08-02T12:00:00.000Z",
    updatedAt: "2026-08-02T12:00:00.000Z",
    ...overrides,
  };
}

test("keeps a queued extraction distinct from a running extraction", () => {
  const session = skillExtractionSessionFromTask(task());
  assert.equal(session?.running, true);
  assert.equal(session?.status, "queued");
  assert.equal(session?.queuedAt, "2026-08-02T12:00:00.000Z");
  assert.equal(session?.processed, 0);
});

test("exposes progress and terminal failures", () => {
  const running = skillExtractionSessionFromTask(task({
    status: "running",
    startedAt: "2026-08-02T12:00:01.000Z",
    updatedAt: "2026-08-02T12:00:10.000Z",
    progress: { total: 100, completed: 24, active: 8, extracted: 23, failed: 1 },
  }));
  assert.equal(running?.status, "running");
  assert.equal(running?.processed, 24);
  assert.equal(running?.inflight, 8);
  assert.equal(running?.lastProgressAt, "2026-08-02T12:00:10.000Z");

  const failed = skillExtractionSessionFromTask(task({
    status: "failed",
    error: "Provider unavailable",
  }));
  assert.equal(failed?.running, false);
  assert.equal(failed?.status, "failed");
  assert.equal(failed?.error, "Provider unavailable");
});
