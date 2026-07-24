import assert from "node:assert/strict";
import test from "node:test";
import { requireRoleScope } from "./roleScope.js";

function run({ method = "GET", path, role = "bidder", admin = false }) {
	let nextCalled = false;
	let status = 200;
	let body = null;
	const req = { method, originalUrl: path, auth: { role, admin } };
	const res = {
		status(code) { status = code; return this; },
		json(value) { body = value; return this; },
	};
	requireRoleScope(req, res, () => { nextCalled = true; });
	return { nextCalled, status, body };
}

test("bidder can use the explicitly scoped extension workflow", () => {
	assert.equal(run({ path: "/api/vendor/tasks?applierName=one" }).nextCalled, true);
	assert.equal(run({ method: "POST", path: "/api/bid-recordings/uploads" }).nextCalled, true);
	assert.equal(run({ method: "GET", path: "/api/personal/agent-job-resume/job-1/pdf" }).nextCalled, true);
});

test("bidder cannot browse Firebase or mutate owner settings", () => {
	assert.equal(run({ path: "/api/firebase/collections" }).status, 403);
	assert.equal(run({ method: "PUT", path: "/api/personal/auto-bid-profile" }).status, 403);
	assert.equal(run({ method: "DELETE", path: "/api/vendor/tasks/task-1" }).status, 403);
});

test("owner and admin roles are not restricted by bidder scope", () => {
	assert.equal(run({ method: "PUT", path: "/api/personal/auto-bid-profile", role: "owner" }).nextCalled, true);
	assert.equal(run({ path: "/api/firebase/collections", role: "admin", admin: true }).nextCalled, true);
});
