import test from "node:test";
import assert from "node:assert/strict";
import { excludeExtensionV2JobsFilter } from "./jobMarketSchema.js";

test("Firestore job pagination uses an equality field for the extension visibility rule", () => {
	const original = process.env.DATABASE_BACKEND;
	try {
		process.env.DATABASE_BACKEND = "firestore";
		assert.deepEqual(excludeExtensionV2JobsFilter(), { extensionV2: false });
		process.env.DATABASE_BACKEND = "mongo";
		assert.deepEqual(excludeExtensionV2JobsFilter(), { version: { $ne: "v2" } });
	} finally {
		if (original === undefined) delete process.env.DATABASE_BACKEND;
		else process.env.DATABASE_BACKEND = original;
	}
});
