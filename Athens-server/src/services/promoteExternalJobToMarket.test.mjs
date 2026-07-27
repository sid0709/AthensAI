import assert from "node:assert/strict";
import test from "node:test";
import {
	externalSourceFieldsFromLink,
	mapExternalDocToMarketJob,
	promoteExternalJobToMarket,
} from "./promoteExternalJobToMarket.js";
import { buildJobIdentity } from "./jobIdentityDedupe.js";

test("externalSourceFieldsFromLink derives Greenhouse from host", () => {
	const fields = externalSourceFieldsFromLink(
		"https://boards.greenhouse.io/acme/jobs/123",
	);
	assert.equal(fields.source, "Greenhouse");
	assert.ok(fields.sourceVersion);
});

test("mapExternalDocToMarketJob maps flat external schema", () => {
	const market = mapExternalDocToMarketJob({
		_id: "ext1",
		sender: "scraper-v1",
		jobID: "gh-99",
		companyName: "Acme",
		companyIcon: "https://example.com/logo.png",
		jobTitle: "Engineer",
		jobDescription: "Build APIs",
		jobLink: "https://boards.greenhouse.io/acme/jobs/99",
		postedAgo: "1 day ago",
		createdAt: new Date("2026-07-01T00:00:00.000Z"),
		aiSkillStatus: "pending",
	});

	assert.equal(market.title, "Engineer");
	assert.equal(market.company.name, "Acme");
	assert.equal(market.company.logo, "https://example.com/logo.png");
	assert.equal(market.applyLink, "https://boards.greenhouse.io/acme/jobs/99");
	assert.equal(market.source, "Greenhouse");
	assert.equal(market.aiSkillStatus, "pending");
	assert.equal(market.matchScoreStatus, "pending");
	assert.equal(market.externalRef.sender, "scraper-v1");
	assert.equal(market.externalRef.jobID, "gh-99");
	assert.equal(market.externalRef.id, "ext1");
	assert.equal(market.postedAgo, "1 day ago");
});

test("mapExternalDocToMarketJob copies enrichment when extracted", () => {
	const market = mapExternalDocToMarketJob({
		_id: "ext2",
		sender: "scraper-v1",
		jobID: "w-1",
		companyName: "Acme",
		jobTitle: "Backend",
		jobDescription: "Go services",
		jobLink: "https://apply.workable.com/acme/j/ABC",
		aiSkillStatus: "extracted",
		aiSkills: [{ name: "Go", category: "hard", requirement: 5 }],
		skills: ["Go"],
		skillsNormalized: ["go"],
		skillTokens: ["go"],
		details: { remote: "Remote" },
		company: { name: "Acme", tags: ["Fintech"], logo: "https://example.com/a.png" },
		aiSkillExtractedAt: "2026-07-02T00:00:00.000Z",
	});

	assert.equal(market.source, "Workable");
	assert.equal(market.aiSkillStatus, "extracted");
	assert.equal(market.matchScoreStatus, "pending");
	assert.deepEqual(market.skills, ["Go"]);
	assert.equal(market.details.remote, "Remote");
	assert.deepEqual(market.company.tags, ["Fintech"]);
});

test("direct promotion applies the same recent company/title duplicate guard", async () => {
	const identity = buildJobIdentity("Acme", "Engineer");
	let marketInserts = 0;
	let externalUpdates = 0;
	const result = await promoteExternalJobToMarket({
		_id: "external-1",
		companyName: " ACME ",
		jobTitle: "engineer",
		jobDescription: "A different description",
		jobLink: "https://example.com/a-different-url",
		createdAt: new Date(),
	}, {
		marketCollection: {
			async findOne() {
				return null;
			},
			async insertOne() {
				marketInserts += 1;
				return { insertedId: "unexpected" };
			},
		},
		externalCollection: {
			async updateOne() {
				externalUpdates += 1;
				return { modifiedCount: 1 };
			},
		},
		identityRegistry: {
			async findOne(filter) {
				assert.equal(filter._id, identity.key);
				return { _id: identity.key, acceptedAt: new Date().toISOString() };
			},
		},
	});

	assert.equal(result.promoted, false);
	assert.equal(result.duplicate, true);
	assert.equal(marketInserts, 0);
	assert.equal(externalUpdates, 2);
});
