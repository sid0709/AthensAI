import { createHash } from "crypto";
import { externalScrapedJobsCollection } from "../../db/mongo.js";
import { chatCompletion } from "../llm/llmService.js";
import { EXTERNAL_JOB_ENRICHMENT_PROMPT } from "../../config/externalJobEnrichmentPrompt.js";
import { JOB_MARKET_MODEL_VERSION } from "../../config/jobMarketSchema.js";
import { normalizeJobSkills, jobSkillTokens, indexJobInRedis } from "../matching/skillIndex.js";
import { enrichJobSkillsFromTitle } from "../matching/jobSkillExtraction.js";
import { recordJobSkills } from "../skillDictionary/skillDictionaryStore.js";
import { parseJobSkillsJson, MAX_ATTEMPTS } from "./aiExtractService.js";

const MAX_CHARS = Number(process.env.JOB_SKILL_EXTRACT_MAX_CHARS || 8000);

const SENIORITY_VALUES = new Set([
	"Entry Level",
	"Associate",
	"Mid Level",
	"Senior Level",
	"Director",
	"Executive",
]);

const REMOTE_VALUES = new Set(["Remote", "Hybrid", "On-site"]);

const EMPLOYMENT_VALUES = new Set([
	"Full-time",
	"Part-time",
	"Contract",
	"Internship",
	"Temporary",
]);

function externalJobText(job) {
	const title = String(job?.jobTitle || job?.title || "").trim();
	const description = String(job?.jobDescription || job?.description || "").trim();
	const text = [title, description].filter(Boolean).join("\n\n");
	return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n\n[truncated]` : text;
}

export function externalDescriptionHash(job) {
	return createHash("sha256")
		.update(String(job?.jobTitle || job?.title || ""))
		.update("")
		.update(String(job?.jobDescription || job?.description || ""))
		.digest("hex");
}

function cleanMetaString(value) {
	const s = String(value ?? "").trim();
	if (!s || s === "—" || s.toLowerCase() === "null") return null;
	return s;
}

/** Parse combined metadata + skills JSON from the external enrichment LLM response. */
export function parseExternalEnrichmentJson(content) {
	if (!content) return { metadata: { details: {}, industryTags: [] }, aiSkills: [] };

	let text = String(content).trim();
	const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
	if (fence) text = fence[1].trim();

	let data;
	try {
		data = JSON.parse(text);
	} catch {
		const braceStart = text.indexOf("{");
		const braceEnd = text.lastIndexOf("}");
		if (braceStart === -1 || braceEnd <= braceStart) {
			return { metadata: { details: {}, industryTags: [] }, aiSkills: [] };
		}
		try {
			data = JSON.parse(text.slice(braceStart, braceEnd + 1));
		} catch {
			return { metadata: { details: {}, industryTags: [] }, aiSkills: [] };
		}
	}

	const rawMeta = data?.metadata && typeof data.metadata === "object" ? data.metadata : {};
	const aiSkills = parseJobSkillsJson(JSON.stringify(data));

	const location = cleanMetaString(rawMeta.location);
	const employmentType = cleanMetaString(rawMeta.employmentType);
	const remote = cleanMetaString(rawMeta.remote);
	const seniority = cleanMetaString(rawMeta.seniority);
	const salary = cleanMetaString(rawMeta.salary);

	const industryTags = Array.isArray(rawMeta.industryTags)
		? rawMeta.industryTags.map((t) => String(t).trim()).filter(Boolean).slice(0, 6)
		: [];

	const details = {};
	if (location) details.position = location;
	if (employmentType && EMPLOYMENT_VALUES.has(employmentType)) details.time = employmentType;
	else if (employmentType) details.time = employmentType;
	if (remote && REMOTE_VALUES.has(remote)) details.remote = remote;
	else if (remote) details.remote = remote;
	if (seniority && SENIORITY_VALUES.has(seniority)) details.seniority = seniority;
	else if (seniority) details.seniority = seniority;
	if (salary) details.money = salary;

	return { metadata: { details, industryTags }, aiSkills };
}

function buildCompanyBlock(job, industryTags) {
	const name = String(job.companyName || job.company?.name || "Unknown").trim() || "Unknown";
	const logo =
		typeof job.companyIcon === "string" && job.companyIcon.trim()
			? job.companyIcon.trim()
			: typeof job.company?.logo === "string"
				? job.company.logo.trim()
				: undefined;
	return {
		name,
		...(logo ? { logo } : {}),
		tags: industryTags,
	};
}

/** Extract metadata + skills for one external job and persist in-place. */
export async function extractAndPersistExternalJob(job, auth, { signal } = {}) {
	if (!externalScrapedJobsCollection) throw new Error("Database not ready");

	const jobId = String(job._id);
	const text = externalJobText(job);
	const titleForFallback = { title: job.jobTitle || job.title || "" };

	let aiSkills;
	let metadata = { details: {}, industryTags: [] };
	let usage = null;

	if (!text) {
		const { skills } = enrichJobSkillsFromTitle(titleForFallback);
		aiSkills = skills.map((name) => ({ name, category: "hard", requirement: 3 }));
	} else {
		const result = await chatCompletion({
			provider: auth.providerId,
			apiKey: auth.apiKey,
			model: auth.model,
			jsonMode: true,
			feature: "external-job-enrich",
			applierName: auth.applierName,
			signal,
			messages: [
				{ role: "system", content: EXTERNAL_JOB_ENRICHMENT_PROMPT },
				{ role: "user", content: `Job posting:\n\n${text}` },
			],
		});
		usage = result?.usage || null;
		const parsed = parseExternalEnrichmentJson(result?.content);
		metadata = parsed.metadata;
		aiSkills = parsed.aiSkills;
		if (!aiSkills.length) {
			const { skills } = enrichJobSkillsFromTitle(titleForFallback);
			aiSkills = skills.map((name) => ({ name, category: "hard", requirement: 3 }));
		}
	}

	const displaySkills = aiSkills.map((s) => s.name);
	const skillsNormalized = normalizeJobSkills(displaySkills);
	const tokens = jobSkillTokens(displaySkills);
	const now = new Date().toISOString();
	const description = String(job.jobDescription || "").trim();

	await externalScrapedJobsCollection.updateOne(
		{ _id: job._id },
		{
			$set: {
				aiSkills,
				skills: displaySkills,
				skillsNormalized,
				skillTokens: tokens,
				details: metadata.details,
				company: buildCompanyBlock(job, metadata.industryTags),
				description,
				aiSkillStatus: "extracted",
				aiSkillsHash: externalDescriptionHash(job),
				aiSkillExtractedAt: now,
				aiSkillError: null,
				matchScoreStatus: "pending",
				modelVersion: JOB_MARKET_MODEL_VERSION,
				updatedAt: new Date(),
			},
			$unset: { aiSkillAttempts: "" },
		},
	);

	await indexJobInRedis(jobId, skillsNormalized, tokens).catch(() => {});
	await recordJobSkills(aiSkills).catch(() => {});

	return { jobId, skillCount: aiSkills.length, usage };
}

/** Record a failed external extraction attempt. */
export async function recordExternalExtractionFailure(job, err) {
	if (!externalScrapedJobsCollection) return;
	const attempts = (Number(job.aiSkillAttempts) || 0) + 1;
	const terminal = attempts >= MAX_ATTEMPTS;
	await externalScrapedJobsCollection.updateOne(
		{ _id: job._id },
		{
			$set: {
				aiSkillStatus: terminal ? "failed" : "pending",
				aiSkillAttempts: attempts,
				aiSkillError: String(err?.message || err).slice(0, 500),
				updatedAt: new Date(),
			},
		},
	);
	return { attempts, terminal };
}

/** Normalize an external doc for match scoring (title/postedAt fields). */
export function normalizeExternalJobForScoring(doc) {
	if (!doc) return doc;
	return {
		...doc,
		title: doc.title || doc.jobTitle || "",
		postedAt: doc.postedAt || doc.createdAt || doc.updatedAt || null,
		_createdAt: doc.createdAt || doc.updatedAt || null,
	};
}
