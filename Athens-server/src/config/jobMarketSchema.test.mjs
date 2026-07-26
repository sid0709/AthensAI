import test from "node:test";
import assert from "node:assert/strict";
import { excludeExtensionV2JobsFilter, isExtensionV2Job } from "./jobMarketSchema.js";

test("Firestore job pagination uses an equality field for the extension visibility rule", () => {
	const original = process.env.DATABASE_BACKEND;
	try {
		process.env.DATABASE_BACKEND = "firestore";
		assert.deepEqual(excludeExtensionV2JobsFilter(), { extensionV2: false });
		process.env.DATABASE_BACKEND = "mongo";
		assert.deepEqual(excludeExtensionV2JobsFilter(), {
			$and: [
				{ version: { $ne: "v2" } },
				{ extensionV2: { $ne: true } },
			],
		});
	} finally {
		if (original === undefined) delete process.env.DATABASE_BACKEND;
		else process.env.DATABASE_BACKEND = original;
	}
});

test("extension-v2 provenance accepts MongoDB and Firestore shapes", () => {
	assert.equal(isExtensionV2Job({ version: "v2" }), true);
	assert.equal(isExtensionV2Job({ extensionV2: true }), true);
	assert.equal(isExtensionV2Job({ version: "v1", extensionV2: false }), false);
});
