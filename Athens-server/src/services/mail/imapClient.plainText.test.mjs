import assert from "node:assert/strict";
import test from "node:test";
import {
	filterExactUnlabeledDocs,
	findTextBodyPart,
	groupMessageTextParts,
} from "./imapClient.js";

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

test("exact unlabeled filtering ignores Gmail system labels only", () => {
	const docs = [
		{ uid: 1, gmailLabels: ["Important", "Starred"] },
		{ uid: 2, gmailLabels: ["Inbox", "Unread"] },
		{ uid: 3, gmailLabels: ["Important", "Notify/Decline"] },
		{ uid: 4, gmailLabels: ["Application"] },
	];
	assert.deepEqual(filterExactUnlabeledDocs(docs).map((doc) => doc.uid), [1, 2]);
});

test("bulk text fetch planning groups UIDs by shared plain or HTML part", () => {
	const plan = groupMessageTextParts([
		{ uid: 1, bodyStructure: { part: "1", type: "text/plain" } },
		{ uid: 2, bodyStructure: { part: "1", type: "text/plain" } },
		{ uid: 3, bodyStructure: { part: "2", type: "text/html" } },
		{ uid: 4, bodyStructure: { part: "1", type: "application/pdf" } },
	]);
	assert.deepEqual(
		plan.groups.map((group) => ({
			partId: group.partId,
			isHtml: group.isHtml,
			uids: group.messages.map((message) => message.uid),
		})),
		[
			{ partId: "1", isHtml: false, uids: [1, 2] },
			{ partId: "2", isHtml: true, uids: [3] },
		],
	);
	assert.deepEqual(plan.unresolved, [4]);
});
