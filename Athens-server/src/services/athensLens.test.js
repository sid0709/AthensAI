import assert from "node:assert/strict";
import test from "node:test";
import { athensLensAuthTest } from "../middleware/athensLensAuth.js";
import { mapAthensLensJob } from "./athensLensJobsService.js";
import { athensLensSessionTest } from "./athensLensSessionService.js";

test("Athens Lens job mapping preserves server data without domain-specific branches", () => {
	const result = mapAthensLensJob(
		{
			_id: "job-1",
			title: "Example role",
			company: { name: "Example company" },
			details: { position: "Chicago, IL", remote: "Hybrid", time: "Contract" },
			postedAt: "2026-08-03T14:30:00.000Z",
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
		location: "Chicago, IL",
		workMode: "Hybrid",
		employmentType: "Contract",
		postedAt: "2026-08-03",
		summary: "Build & improve useful workflows.",
		description: "Build & improve useful workflows.",
		responsibilities: ["Own delivery"],
		qualifications: ["Clear communication"],
		applyUrl: "https://example.com/apply/1",
		bidReadyAt: "2026-08-04",
	});
});

test("Athens Lens mapping rejects unsafe application schemes", () => {
	const result = mapAthensLensJob(
		{ _id: "job-2", title: "Role", companyName: "Company", applyLink: "javascript:alert(1)" },
		{ jobId: "job-2" },
	);
	assert.equal(result.applyUrl, "");
});

test("Athens Lens bearer tokens are parsed and hashed before Redis lookup", () => {
	assert.equal(
		athensLensAuthTest.bearerToken({ headers: { authorization: "Bearer session-secret" } }),
		"session-secret",
	);
	const key = athensLensSessionTest.sessionKey("session-secret");
	assert.match(key, /^athens-lens:session:v1:[a-f0-9]{64}$/);
	assert.equal(key.includes("session-secret"), false);
});
