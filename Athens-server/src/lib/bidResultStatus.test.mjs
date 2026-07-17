import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deriveBidUiStatus } from "./bidResultStatus.js";
import {
	buildCanonicalResumeStem,
	buildCanonicalResumeFileName,
	isResumeNameMismatch,
	sanitizeResumeSegment,
} from "./canonicalResumeName.js";

describe("deriveBidUiStatus", () => {
	it("prefers reviewStatus rejected over status skipped", () => {
		assert.equal(
			deriveBidUiStatus({ status: "skipped", progress: "skipped", reviewStatus: "rejected" }),
			"rejected",
		);
	});

	it("prefers reviewStatus submitted over skipped", () => {
		assert.equal(
			deriveBidUiStatus({ status: "skipped", reviewStatus: "submitted" }),
			"submitted",
		);
	});

	it("returns skipped when reviewStatus is null", () => {
		assert.equal(
			deriveBidUiStatus({ status: "skipped", progress: "skipped", reviewStatus: null }),
			"skipped",
		);
	});

	it("returns in_process when bidderInProcess", () => {
		assert.equal(deriveBidUiStatus({ bidderInProcess: true }), "in_process");
	});

	it("returns submitted for done without reviewStatus", () => {
		assert.equal(deriveBidUiStatus({ status: "done", progress: "completed" }), "submitted");
	});
});

describe("canonicalResumeName", () => {
	it("builds Company - Title - Profile - shortId", () => {
		const stem = buildCanonicalResumeStem(
			"Acme",
			"Senior Software Engineer",
			"Eli Taylor",
			"507f1f77bcf86cd799439011",
		);
		assert.match(stem, /^Acme - Senior Software Engineer - Eli Taylor - /);
		assert.ok(stem.includes("799439011") || stem.endsWith("cf86cd799439011".slice(-12)));
	});

	it("folder stem equals file stem", () => {
		const stem = buildCanonicalResumeStem("Acme", "Eng", "Eli Taylor", "abc123");
		const file = buildCanonicalResumeFileName("Acme", "Eng", "Eli Taylor", "abc123", ".pdf");
		assert.equal(file, `${stem}.pdf`);
	});

	it("mismatch is case-sensitive original vs expected", () => {
		assert.equal(
			isResumeNameMismatch("Acme - Role - Eli.pdf", "Acme - Role - Eli.pdf"),
			false,
		);
		assert.equal(
			isResumeNameMismatch("acme - Role - Eli.pdf", "Acme - Role - Eli.pdf"),
			true,
		);
		assert.equal(
			isResumeNameMismatch("EliTaylor.pdf", "Acme - Role - Eli Taylor - abc.pdf"),
			true,
		);
	});

	it("sanitizes reserved windows names", () => {
		assert.equal(sanitizeResumeSegment("CON"), "_CON");
	});
});
