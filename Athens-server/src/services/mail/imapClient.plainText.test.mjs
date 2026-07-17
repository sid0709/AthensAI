import assert from "node:assert/strict";
import test from "node:test";
import { findTextBodyPart } from "./imapClient.js";

test("findTextBodyPart prefers text/plain in multipart/alternative", () => {
	const structure = {
		type: "multipart/alternative",
		childNodes: [
			{ part: "1", type: "text/plain", parameters: { charset: "utf-8" } },
			{ part: "2", type: "text/html", parameters: { charset: "utf-8" } },
		],
	};
	const plain = findTextBodyPart(structure, false);
	assert.equal(plain.part, "1");
	assert.equal(plain.type, "text/plain");

	const html = findTextBodyPart(structure, true);
	assert.equal(html.part, "2");
	assert.equal(html.type, "text/html");
});

test("findTextBodyPart defaults part to 1 for single-part messages", () => {
	const structure = { type: "text/plain", parameters: { charset: "us-ascii" } };
	const plain = findTextBodyPart(structure, false);
	assert.equal(plain.part, "1");
});

test("findTextBodyPart returns null when no matching part", () => {
	const structure = {
		type: "multipart/mixed",
		childNodes: [{ part: "1", type: "application/pdf" }],
	};
	assert.equal(findTextBodyPart(structure, false), null);
	assert.equal(findTextBodyPart(structure, true), null);
});
