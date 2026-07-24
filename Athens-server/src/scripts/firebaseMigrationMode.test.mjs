import test from "node:test";
import assert from "node:assert/strict";
import { applyLegacyCredentialPolicy, includesFirebaseAuth } from "./firebaseMigrationMode.js";

test("data-only migration preserves owner and vendor bcrypt hashes", () => {
	const account = { name: "Owner", password: "$2b$10$owner", vendorPassword: "$2b$10$vendor" };
	applyLegacyCredentialPolicy(account, false);
	assert.equal(account.password, "$2b$10$owner");
	assert.equal(account.vendorPassword, "$2b$10$vendor");
});

test("Firebase Auth mode is explicit and strips legacy hashes", () => {
	assert.equal(includesFirebaseAuth(undefined), false);
	assert.equal(includesFirebaseAuth("true"), true);
	const account = { password: "owner", vendorPassword: "vendor" };
	applyLegacyCredentialPolicy(account, true);
	assert.deepEqual(account, {});
});
