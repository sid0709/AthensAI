import assert from "node:assert/strict";
import test from "node:test";
import {
  DESTINATION_TIMEOUT_MS,
  FULL_INTRO_MS,
  REDUCED_INTRO_MS,
  REPEAT_INTRO_MS,
  authExperienceReducer,
  createAuthExperienceState,
  introDuration,
  resolveAuthIdentity,
} from "./authExperienceState";

const idle = createAuthExperienceState({
  now: 0,
  shouldIntro: false,
  seenIntro: false,
  reducedMotion: false,
});

test("intro timing adapts for first, repeat, and reduced-motion visits", () => {
  assert.equal(introDuration(false, false), FULL_INTRO_MS);
  assert.equal(introDuration(true, false), REPEAT_INTRO_MS);
  assert.equal(introDuration(false, true), REDUCED_INTRO_MS);
});

test("failed authentication returns to the interactive login state", () => {
  const authenticating = authExperienceReducer(idle, { type: "BEGIN_AUTH", now: 10 });
  const failure = authExperienceReducer(authenticating, { type: "AUTH_FAILED", now: 20 });
  const restored = authExperienceReducer(failure, { type: "FAILURE_COMPLETE", now: 370 });
  assert.equal(authenticating.phase, "authenticating");
  assert.equal(failure.phase, "failure");
  assert.equal(restored.phase, "idle");
});

test("successful authentication never needs profile data to reach reveal", () => {
  const authenticating = authExperienceReducer(idle, { type: "BEGIN_AUTH", now: 10 });
  const ignition = authExperienceReducer(authenticating, {
    type: "AUTH_SUCCEEDED",
    now: 20,
    accountName: "Robin",
    offline: true,
  });
  const travel = authExperienceReducer(ignition, { type: "IGNITION_COMPLETE", now: 220 });
  const ready = authExperienceReducer(travel, { type: "APP_SHELL_READY", now: 260 });
  const reveal = authExperienceReducer(ready, { type: "TRAVEL_COMPLETE", now: 1_320 });

  assert.equal(ignition.accountName, "Robin");
  assert.equal(ignition.offline, true);
  assert.equal(reveal.phase, "reveal");
});

test("skip waits for the app shell but not a network-loaded profile", () => {
  const authenticating = authExperienceReducer(idle, { type: "BEGIN_AUTH", now: 10 });
  const ignition = authExperienceReducer(authenticating, {
    type: "AUTH_SUCCEEDED",
    now: 20,
    accountName: null,
    offline: false,
  });
  const skipped = authExperienceReducer(ignition, { type: "REQUEST_SKIP", now: 30 });
  const reveal = authExperienceReducer(skipped, { type: "APP_SHELL_READY", now: 40 });

  assert.equal(skipped.skipRequested, true);
  assert.equal(reveal.phase, "reveal");
  assert.equal(resolveAuthIdentity("   "), null);
  assert.equal(DESTINATION_TIMEOUT_MS, 4_000);
});

test("hard timeout can reveal even when destination readiness is unavailable", () => {
  const authenticating = authExperienceReducer(idle, { type: "BEGIN_AUTH", now: 10 });
  const ignition = authExperienceReducer(authenticating, {
    type: "AUTH_SUCCEEDED",
    now: 20,
    accountName: "Athens user",
    offline: false,
  });
  const reveal = authExperienceReducer(ignition, { type: "TRAVEL_COMPLETE", now: 4_020, force: true });
  assert.equal(reveal.phase, "reveal");
});

test("connectivity loss after authentication preserves identity and transition progress", () => {
  const authenticating = authExperienceReducer(idle, { type: "BEGIN_AUTH", now: 10 });
  const ignition = authExperienceReducer(authenticating, {
    type: "AUTH_SUCCEEDED",
    now: 20,
    accountName: "Robin",
    offline: false,
  });
  const offline = authExperienceReducer(ignition, { type: "SET_OFFLINE", offline: true });

  assert.equal(offline.phase, "ignition");
  assert.equal(offline.accountName, "Robin");
  assert.equal(offline.offline, true);
});

test("skipping the intro immediately restores the auth form", () => {
  const intro = createAuthExperienceState({
    now: 0,
    shouldIntro: true,
    seenIntro: false,
    reducedMotion: false,
  });
  const skipped = authExperienceReducer(intro, { type: "REQUEST_SKIP", now: 50 });
  assert.equal(skipped.phase, "idle");
  assert.equal(skipped.introDurationMs, 0);
});
