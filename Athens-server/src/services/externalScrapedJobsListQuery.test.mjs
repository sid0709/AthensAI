import { test } from "node:test";
import assert from "node:assert/strict";
import {
	buildExternalScrapedJobsQuery,
	normalizeExternalScrapedJob,
	shouldMergeExternal,
	externalAllowedForStatusTab,
	hasBlockingFiltersForExternal,
	resolveStatusTabFromBody,
} from "./externalScrapedJobsListQuery.js";

test("buildExternalScrapedJobsQuery maps q to jobTitle regex", () => {
	const query = buildExternalScrapedJobsQuery({ q: "engineer" });
	assert.ok(query.jobTitle);
	assert.match(query.jobTitle.$regex, /engineer/i);
});

test("buildExternalScrapedJobsQuery maps company.name to companyName regex", () => {
	const query = buildExternalScrapedJobsQuery({ "company.name": "XMTP" });
	assert.ok(query.companyName);
	assert.match(query.companyName.$regex, /XMTP/i);
});

test("buildExternalScrapedJobsQuery filters by jobSources", () => {
	const query = buildExternalScrapedJobsQuery({ jobSources: "LinkedIn,Indeed" });
	assert.ok(query.$or);
	assert.equal(query.$or.length, 2);
});

test("normalizeExternalScrapedJob uses stored source when present", () => {
	const normalized = normalizeExternalScrapedJob({
		_id: "abc123",
		sender: "li-job-scraper",
		companyName: "XMTP Labs",
		companyIcon: "https://example.com/logo.png",
		jobTitle: "Join our bench",
		jobDescription: "Culture-first team.",
		jobLink: "https://www.linkedin.com/jobs/view/123/",
		source: "LinkedIn",
		postedAgo: "8 months ago",
		createdAt: "2026-07-07T13:14:25.992Z",
	});

	assert.equal(normalized.catalog, "external");
	assert.equal(normalized.title, "Join our bench");
	assert.equal(normalized.company.name, "XMTP Labs");
	assert.equal(normalized.applyLink, "https://www.linkedin.com/jobs/view/123/");
	assert.equal(normalized.source, "LinkedIn");
	assert.equal(normalized.jobDescription, "Culture-first team.");
	assert.equal(normalized.postedAt, "2026-07-07T13:14:25.992Z");
});

test("buildExternalScrapedJobsQuery filters aiExtracted", () => {
	const query = buildExternalScrapedJobsQuery({ aiExtracted: true });
	assert.equal(query.aiSkillStatus, "extracted");
});

test("normalizeExternalScrapedJob passes through enriched AI fields", () => {
	const normalized = normalizeExternalScrapedJob({
		_id: "abc123",
		sender: "li-job-scraper",
		companyName: "XMTP Labs",
		jobTitle: "Senior Backend Engineer",
		jobDescription: "Build APIs with Go.",
		jobLink: "https://example.com/job",
		createdAt: "2026-07-07T13:14:25.992Z",
		details: { position: "Remote", remote: "Remote", seniority: "Senior Level" },
		company: { name: "XMTP Labs", tags: ["Fintech"] },
		aiSkillStatus: "extracted",
		aiSkills: [{ name: "Go", category: "hard", requirement: 5 }],
		skills: ["Go"],
	});

	assert.equal(normalized.aiSkillStatus, "extracted");
	assert.equal(normalized.details.position, "Remote");
	assert.equal(normalized.company.tags[0], "Fintech");
	assert.deepEqual(normalized.aiSkills[0].name, "Go");
});

test("normalizeExternalScrapedJob infers source from jobLink when missing", () => {
	const normalized = normalizeExternalScrapedJob({
		_id: "x",
		sender: "li-job-scraper",
		companyName: "Acme",
		jobTitle: "Role",
		jobDescription: "Desc",
		jobLink: "https://boards.greenhouse.io/acme/jobs/1",
	});
	assert.equal(normalized.source, "Greenhouse");
});

test("externalAllowedForStatusTab includes all and posted only", () => {
	assert.equal(externalAllowedForStatusTab("all"), true);
	assert.equal(externalAllowedForStatusTab("posted"), true);
	assert.equal(externalAllowedForStatusTab("applied"), false);
	assert.equal(externalAllowedForStatusTab("scheduled"), false);
	assert.equal(externalAllowedForStatusTab("declined"), false);
});

test("resolveStatusTabFromBody maps applied/status fields", () => {
	assert.equal(resolveStatusTabFromBody({ applied: false }), "posted");
	assert.equal(resolveStatusTabFromBody({ applied: true }), "applied");
	assert.equal(resolveStatusTabFromBody({ applied: true, status: "Scheduled" }), "scheduled");
	assert.equal(resolveStatusTabFromBody({}), "all");
});

test("shouldMergeExternal respects flag, blocking filters, and status tab", () => {
	const base = { includeExternalScraped: true };
	assert.equal(shouldMergeExternal(base, "all"), true);
	assert.equal(shouldMergeExternal(base, "posted"), true);
	assert.equal(shouldMergeExternal(base, "applied"), false);
	assert.equal(shouldMergeExternal({ ...base, aiExtracted: true }, "all"), true);
	assert.equal(shouldMergeExternal({ ...base, scoreOverallMin: "10" }, "all"), false);
	assert.equal(shouldMergeExternal({ includeExternalScraped: false }, "all"), false);
});

test("hasBlockingFiltersForExternal ignores default score bounds", () => {
	assert.equal(hasBlockingFiltersForExternal({}), false);
	assert.equal(hasBlockingFiltersForExternal({ scoreOverallMin: "0", scoreOverallMax: "100" }), false);
	assert.equal(hasBlockingFiltersForExternal({ scoreSkillMax: "80" }), true);
});
