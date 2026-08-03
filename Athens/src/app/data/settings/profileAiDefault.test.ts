import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProfileSavePayload,
  emptyProfile,
  resolveSavedProfileAiDefault,
} from "./profile";

test("the UI resolves only the provider-compatible saved Profile default", () => {
  assert.deepEqual(
    resolveSavedProfileAiDefault({
      defaultProvider: "deepseek",
      defaultModel: "deepseek-v4-flash",
    }),
    { provider: "deepseek", model: "deepseek-v4-flash" },
  );
  assert.equal(
    resolveSavedProfileAiDefault({
      defaultProvider: "deepseek",
      defaultModel: "gpt-5.4-mini",
    }),
    null,
  );
});

test("general Profile saves omit fields owned by the default-model endpoint", () => {
  const payload = buildProfileSavePayload({
    ...emptyProfile(),
    defaultProvider: "deepseek",
    defaultModel: "deepseek-v4-flash",
  }, "Test User", false);

  assert.equal("defaultProvider" in payload, false);
  assert.equal("defaultModel" in payload, false);
});
