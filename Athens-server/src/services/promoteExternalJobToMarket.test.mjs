import assert from "node:assert/strict";
import test from "node:test";
import {
	externalSourceFieldsFromLink,
	mapExternalDocToMarketJob,
} from "./promoteExternalJobToMarket.js";

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
