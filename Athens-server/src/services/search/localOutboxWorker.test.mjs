import test from "node:test";
import assert from "node:assert/strict";
import { localOutboxWorkerTest } from "./localOutboxWorker.js";

test("local search outbox requires both Algolia credentials", () => {
	const originalId = process.env.ALGOLIA_APP_ID;
	const originalKey = process.env.ALGOLIA_ADMIN_API_KEY;
	try {
		delete process.env.ALGOLIA_APP_ID;
		delete process.env.ALGOLIA_ADMIN_API_KEY;
		assert.equal(localOutboxWorkerTest.configured(), false);
		process.env.ALGOLIA_APP_ID = "app";
		assert.equal(localOutboxWorkerTest.configured(), false);
		process.env.ALGOLIA_ADMIN_API_KEY = "key";
		assert.equal(localOutboxWorkerTest.configured(), true);
	} finally {
		if (originalId === undefined) delete process.env.ALGOLIA_APP_ID;
		else process.env.ALGOLIA_APP_ID = originalId;
		if (originalKey === undefined) delete process.env.ALGOLIA_ADMIN_API_KEY;
		else process.env.ALGOLIA_ADMIN_API_KEY = originalKey;
	}
});
