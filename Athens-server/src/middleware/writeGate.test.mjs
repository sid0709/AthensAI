import test from "node:test";
import assert from "node:assert/strict";
import { requireWritesEnabled } from "./writeGate.js";

function invoke({ method = "POST", url = "/api/jobs", headers = {} } = {}) {
	let nextCalled = false;
	let statusCode = 200;
	let payload = null;
	const req = { method, originalUrl: url, url, headers };
	const res = {
		status(code) { statusCode = code; return this; },
		json(value) { payload = value; return this; },
	};
	requireWritesEnabled(req, res, () => { nextCalled = true; });
	return { nextCalled, statusCode, payload };
}

test("read-only cutover allows legacy owner and bidder sign-in posts", () => {
	process.env.FIRESTORE_WRITES_ENABLED = "false";
	assert.equal(invoke({ url: "/api/auth/signin" }).nextCalled, true);
	assert.equal(invoke({ url: "/api/auth/bidder-signin?source=extension" }).nextCalled, true);
});

test("read-only cutover blocks signup and data mutation posts", () => {
	process.env.FIRESTORE_WRITES_ENABLED = "false";
	for (const url of ["/api/auth/signup", "/api/jobs"]) {
		const result = invoke({ url });
		assert.equal(result.nextCalled, false);
		assert.equal(result.statusCode, 503);
		assert.equal(result.payload.code, "WRITES_DISABLED");
	}
});
