import { test } from "node:test";
import assert from "node:assert/strict";
import { needsIdentitySync } from "./refreshGeneratedResumesIdentity.js";

test("needsIdentitySync is true when identitySyncedAt is missing", () => {
  assert.equal(needsIdentitySync({}, "2026-07-15T12:00:00.000Z"), true);
  assert.equal(needsIdentitySync({ identitySyncedAt: null }, "2026-07-15T12:00:00.000Z"), true);
});

test("needsIdentitySync is true when résumé sync is older than profile updatedAt", () => {
  assert.equal(
    needsIdentitySync(
      { identitySyncedAt: "2026-07-15T10:00:00.000Z" },
      "2026-07-15T12:00:00.000Z",
    ),
    true,
  );
});

test("needsIdentitySync is false when résumé already matches profile updatedAt", () => {
  const at = "2026-07-15T12:00:00.000Z";
  assert.equal(needsIdentitySync({ identitySyncedAt: at }, at), false);
  assert.equal(
    needsIdentitySync(
      { identitySyncedAt: "2026-07-15T13:00:00.000Z" },
      "2026-07-15T12:00:00.000Z",
    ),
    false,
  );
});
