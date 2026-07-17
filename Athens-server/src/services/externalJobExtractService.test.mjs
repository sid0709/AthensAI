import { test } from "node:test";
import assert from "node:assert/strict";
import { parseExternalEnrichmentJson } from "./jobSkillExtraction/externalJobExtractService.js";

test("parseExternalEnrichmentJson extracts metadata and skills", () => {
	const content = JSON.stringify({
		metadata: {
			location: "Germany",
			employmentType: "Full-time",
			remote: "Remote",
			seniority: "Senior Level",
			salary: "$120k–$150k",
			industryTags: ["Fintech", "Enterprise Software"],
		},
		skills: [
			{ name: "Java", category: "hard", requirement: 5 },
			{ name: "Mentoring", category: "soft", requirement: 3 },
		],
	});

	const { metadata, aiSkills } = parseExternalEnrichmentJson(content);
	assert.equal(metadata.details.position, "Germany");
	assert.equal(metadata.details.time, "Full-time");
	assert.equal(metadata.details.remote, "Remote");
	assert.equal(metadata.details.seniority, "Senior Level");
	assert.equal(metadata.details.money, "$120k–$150k");
	assert.deepEqual(metadata.industryTags, ["Fintech", "Enterprise Software"]);
	assert.equal(aiSkills.length, 2);
	assert.equal(aiSkills[0].name, "Java");
});

test("parseExternalEnrichmentJson tolerates markdown fences", () => {
	const content = '```json\n{"metadata":{"location":"NYC"},"skills":[{"name":"Python","category":"hard","requirement":4}]}\n```';
	const { metadata, aiSkills } = parseExternalEnrichmentJson(content);
	assert.equal(metadata.details.position, "NYC");
	assert.equal(aiSkills[0].name, "Python");
});

test("parseExternalEnrichmentJson returns empty on invalid JSON", () => {
	const { metadata, aiSkills } = parseExternalEnrichmentJson("not json");
	assert.deepEqual(metadata.details, {});
	assert.deepEqual(metadata.industryTags, []);
	assert.equal(aiSkills.length, 0);
});
