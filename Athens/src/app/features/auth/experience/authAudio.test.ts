import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSoundPreference, shouldAutoEnableSound } from "./authAudio";

test("sound preference only accepts the supported session values", () => {
  assert.equal(normalizeSoundPreference("on"), "on");
  assert.equal(normalizeSoundPreference("off"), "off");
  assert.equal(normalizeSoundPreference("unexpected"), null);
  assert.equal(normalizeSoundPreference(null), null);
});

test("automatic sound never overrides an explicit mute", () => {
  assert.equal(shouldAutoEnableSound(null), true);
  assert.equal(shouldAutoEnableSound("on"), true);
  assert.equal(shouldAutoEnableSound("off"), false);
});
