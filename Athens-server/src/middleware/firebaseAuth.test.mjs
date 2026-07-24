import assert from "node:assert/strict";
import test from "node:test";
import { firebaseAuthTest } from "./firebaseAuth.js";

test("implicit requests inherit the token's primary profile", () => {
	const grant = { profileId: "profile-1", profileName: "Owner One", primary: true };
	assert.equal(firebaseAuthTest.grantFor({ grants: [grant] }), grant);
	const req = { url: "/api/vendor/tasks", body: {} };
	firebaseAuthTest.injectGrantedProfile(req, grant);
	assert.equal(req.body.applierName, "Owner One");
	assert.equal(req.body.profileId, "profile-1");
	assert.match(req.url, /applierName=Owner\+One/);
	assert.match(req.url, /profileId=profile-1/);
});

test("an explicitly requested grant wins over another primary grant", () => {
	const primary = { profileId: "profile-1", profileName: "Owner One", primary: true };
	const requested = { profileId: "profile-2", profileName: "Owner Two" };
	assert.equal(firebaseAuthTest.grantFor({ grants: [primary, requested] }, ["Owner Two"]), requested);
});
