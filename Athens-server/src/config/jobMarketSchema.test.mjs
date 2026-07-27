import test from "node:test";
import assert from "node:assert/strict";
import { excludeExtensionV2JobsFilter, isExtensionV2Job } from "./jobMarketSchema.js";

test("Firestore job pagination uses an equality field for the extension visibility rule", () => {
	assert.deepEqual(excludeExtensionV2JobsFilter(), { extensionV2: false });
});

test("extension-v2 provenance accepts version and indexed-flag shapes", () => {
	assert.equal(isExtensionV2Job({ version: "v2" }), true);
	assert.equal(isExtensionV2Job({ extensionV2: true }), true);
	assert.equal(isExtensionV2Job({ version: "v1", extensionV2: false }), false);
});
