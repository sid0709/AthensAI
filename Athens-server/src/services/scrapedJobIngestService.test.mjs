import assert from "node:assert/strict";
import test from "node:test";
import { buildJobIdentity } from "./jobIdentityDedupe.js";
import { ingestScrapedJob, validateScrapedJobInput } from "./scrapedJobIngestService.js";

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

test("company/title duplicate creates neither external nor market document", async () => {
	const identity = buildJobIdentity(" acme ", "ENGINEER");
	let externalInserts = 0;
	let promotions = 0;
	const result = await ingestScrapedJob(validJob, {
		marketCollection: {
			find() {
				return { toArray: async () => [] };
			},
		},
		externalCollection: {
			async insertOne() {
				externalInserts += 1;
				return { insertedId: "unexpected" };
			},
		},
		identityRegistry: {
			async findOne(filter) {
				assert.equal(filter._id, identity.key);
				return { _id: identity.key, acceptedAt: new Date().toISOString(), jobId: "existing" };
			},
		},
		promoteExternalJobToMarket: async () => {
			promotions += 1;
			return { promoted: true, marketId: "unexpected" };
		},
	});

	assert.equal(result.created, false);
	assert.equal(result.duplicate, true);
	assert.match(result.reason, /company and title/i);
	assert.equal(externalInserts, 0);
	assert.equal(promotions, 0);
});
