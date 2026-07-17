import assert from "node:assert/strict";
import test from "node:test";
import { validateScrapedJobInput } from "./scrapedJobIngestService.js";

const validJob = {
	sender: "scraper-v1",
	jobID: "linkedin-123",
	companyName: "Acme",
	jobTitle: "Engineer",
	jobDescription: "Build things",
	jobLink: "https://jobs.example.com/123",
};

test("validateScrapedJobInput requires jobID", () => {
	const result = validateScrapedJobInput({ ...validJob, jobID: "" });
	assert.equal(result.ok, false);
	assert.match(result.error, /jobID is required/);
});

test("validateScrapedJobInput accepts job_id alias", () => {
	const { jobID, ...rest } = validJob;
	const result = validateScrapedJobInput({ ...rest, job_id: "ext-99" });
	assert.equal(result.ok, true);
	assert.equal(result.job.jobID, "ext-99");
});

test("validateScrapedJobInput stores jobID on normalized job", () => {
	const result = validateScrapedJobInput(validJob);
	assert.equal(result.ok, true);
	assert.equal(result.job.jobID, "linkedin-123");
});

test("validateScrapedJobInput ignores client source", () => {
	const result = validateScrapedJobInput({ ...validJob, source: "linkedin" });
	assert.equal(result.ok, true);
	assert.equal(result.job.source, undefined);
});
