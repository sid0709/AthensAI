import test from "node:test";
import assert from "node:assert/strict";

import { heuristicFlags } from "./bidJobAnalyzeService.js";

test("remote is green when remote and hybrid locations are both offered", () => {
	const text = "Location(s): US (remote), Boston (hybrid), or New York (hybrid).";
	assert.equal(heuristicFlags(text, ["remote"]).remote.status, "green");
});

test("office business language and customer visits are not onsite requirements", () => {
	const text =
		"The team helps streamline back-office operations and may visit stores to understand workflows.";
	assert.equal(heuristicFlags(text, ["remote"]).remote.status, "green");
});

test("relocation assistance alone is not a relocation requirement", () => {
	const text = "Relocation assistance may be available for candidates who choose to move.";
	assert.equal(heuristicFlags(text, ["remote"]).remote.status, "green");
});

test("an unambiguous hybrid requirement with no remote option is red", () => {
	const text = "This is a hybrid role requiring three days per week in the Boston office.";
	assert.equal(heuristicFlags(text, ["remote"]).remote.status, "red");
});

test("an explicit denial of remote work is red", () => {
	const text = "This role is not remote and requires regular in-person attendance.";
	assert.equal(heuristicFlags(text, ["remote"]).remote.status, "red");
});
