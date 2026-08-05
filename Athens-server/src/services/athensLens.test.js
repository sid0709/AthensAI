import assert from "node:assert/strict";
import test from "node:test";
import { athensLensAuthTest } from "../middleware/athensLensAuth.js";
import { mapAthensLensJob } from "./athensLensJobsService.js";
import { athensLensSessionTest } from "./athensLensSessionService.js";
import {
	mapAthensLensGmailEnvelope,
	mapAthensLensGmailMessage,
} from "../controllers/athensLensMailController.js";

test("Athens Lens job mapping preserves server data without domain-specific branches", () => {
	const result = mapAthensLensJob(
		{
			_id: "job-1",
			title: "Example role",
			company: { name: "Example company", logo: "//cdn.example.com/company.png" },
			details: { position: "Chicago, IL", remote: "Hybrid", time: "Contract" },
			seniority: "Mid level",
			salary: "$100k–$120k",
			experience: "3+ years",
			postedAt: "2026-08-03T14:30:00.000Z",
			skills: ["Planning"],
			aiSkills: [{ name: "Communication" }],
			tags: ["New"],
			applicants: { count: 42 },
			description: "<p>Build &amp; improve useful workflows.</p>",
			responsibilities: ["Own delivery"],
			qualifications: ["Clear communication"],
			applyLink: "https://example.com/apply/1",
		},
		{ jobId: "job-1", bidReadyDate: "2026-08-04T10:00:00.000Z" },
	);

	assert.deepEqual(result, {
		id: "job-1",
		title: "Example role",
		company: "Example company",
		companyLogoUrl: "https://cdn.example.com/company.png",
		location: "Chicago, IL",
		workMode: "Hybrid",
		employmentType: "Contract",
		seniority: "Mid level",
		salary: "$100k–$120k",
		experience: "3+ years",
		postedAt: "2026-08-03",
		skills: ["Communication", "Planning"],
		tags: ["New"],
		applicantsText: "42 applicants",
		description: "Build & improve useful workflows.",
		responsibilities: ["Own delivery"],
		qualifications: ["Clear communication"],
		applyUrl: "https://example.com/apply/1",
		bidReadyAt: "2026-08-04",
	});
});

test("Athens Lens maps live Gmail content and extracts security codes", () => {
	const message = mapAthensLensGmailMessage({
		uid: 42,
		from: "security@example.com",
		fromName: "Account Security",
		subject: "Your security code",
		date: "2026-08-04T12:30:00.000Z",
		bodyText: "Use security code: 482917\n\nThis code expires soon.",
		seen: false,
	});

	assert.equal(message.id, "42");
	assert.equal(message.securityCode, "482917");
	assert.equal(message.kind, "security-code");
	assert.equal(message.isUnread, true);
	assert.equal(message.bodyLoaded, true);
	assert.deepEqual(message.body, ["Use security code: 482917", "This code expires soon."]);
});

test("Athens Lens Gmail envelopes render before message bodies", () => {
	const message = mapAthensLensGmailEnvelope({
		uid: 43,
		from: "security@example.com",
		fromName: "Account Security",
		subject: "Your code is 731204",
		date: "2026-08-04T12:31:00.000Z",
		seen: true,
	});

	assert.equal(message.id, "43");
	assert.equal(message.securityCode, "731204");
	assert.equal(message.bodyLoaded, false);
	assert.deepEqual(message.body, []);
});

test("Athens Lens mapping rejects unsafe application schemes", () => {
	const result = mapAthensLensJob(
		{ _id: "job-2", title: "Role", companyName: "Company", applyLink: "javascript:alert(1)" },
		{ jobId: "job-2" },
	);
	assert.equal(result.applyUrl, "");
});

test("Athens Lens job mapping preserves line breaks from HTML descriptions", () => {
	const result = mapAthensLensJob(
		{
			_id: "job-3",
			title: "Role",
			companyName: "Company",
			description: "<p>First paragraph</p><p>Second paragraph</p><br>Trailing line",
		},
		{ jobId: "job-3" },
	);
	assert.match(result.description, /First paragraph\n+Second paragraph\n+Trailing line/);
});

test("Athens Lens job mapping breaks jammed plain-text section labels", () => {
	const result = mapAthensLensJob(
		{
			_id: "job-4",
			title: "Role",
			companyName: "Company",
			description:
				"Intro sentence. Responsibilities Apply expertise to help train models Qualification Proficiency in Python3",
		},
		{ jobId: "job-4" },
	);
	assert.match(result.description, /Intro sentence\.\n+Responsibilities\nApply expertise/);
	assert.match(result.description, /models\n+Qualification\nProficiency in Python3/);
});

test("Athens Lens bearer tokens are parsed and hashed before Firestore lookup", () => {
	assert.equal(
		athensLensAuthTest.bearerToken({ headers: { authorization: "Bearer session-secret" } }),
		"session-secret",
	);
	const key = athensLensSessionTest.sessionKey("session-secret");
	assert.match(key, /^[a-f0-9]{64}$/);
	assert.equal(key.includes("session-secret"), false);
});
