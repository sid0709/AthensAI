import { DocumentId } from "@nextoffer/shared/document-id";
import { jobsCollection } from "../db/dataStore.js";
import { resolveApplierId } from "./jobBidStatusService.js";
import { readCanonicalProjectedJobStatusIdsByState } from "./jobStatusProjectionService.js";

const JOB_PROJECTION = {
	title: 1,
	company: 1,
	companyName: 1,
	companyIcon: 1,
	applyLink: 1,
	jobLink: 1,
	source: 1,
	postedAt: 1,
	_createdAt: 1,
	createdAt: 1,
	details: 1,
	location: 1,
	workMode: 1,
	employmentType: 1,
	seniority: 1,
	salary: 1,
	experience: 1,
	skills: 1,
	aiSkills: 1,
	tags: 1,
	applicants: 1,
	description: 1,
	jobDescription: 1,
	responsibilities: 1,
	qualifications: 1,
};

function text(value) {
	return typeof value === "string" ? value.trim() : "";
}

function plainText(value) {
	return text(value)
		.replace(/<[^>]*>/g, " ")
		.replace(/&nbsp;/gi, " ")
		.replace(/&amp;/gi, "&")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/gi, "'")
		.replace(/\s+/g, " ")
		.trim();
}

function textList(value) {
	if (!Array.isArray(value)) return [];
	return value.map((item) => plainText(item)).filter(Boolean);
}

function uniqueTextList(values) {
	const seen = new Set();
	return values.flatMap((value) => {
		const normalized = plainText(value);
		const key = normalized.toLocaleLowerCase("en-US");
		if (!normalized || seen.has(key)) return [];
		seen.add(key);
		return [normalized];
	});
}

function displayText(value) {
	return Array.isArray(value) ? uniqueTextList(value).join(", ") : text(value);
}

function skillNames(job) {
	const analyzed = Array.isArray(job?.aiSkills)
		? job.aiSkills.map((skill) => typeof skill === "string" ? skill : skill?.name)
		: [];
	return uniqueTextList([...analyzed, ...textList(job?.skills)]);
}

function applicantsText(value) {
	if (typeof value === "string") return plainText(value);
	if (!value || typeof value !== "object") return "";
	if (text(value.text)) return text(value.text);
	const count = Number(value.count);
	return Number.isFinite(count) && count >= 0 ? `${count} applicants` : "";
}

function companyName(job) {
	if (typeof job?.company === "string") return text(job.company);
	return text(job?.company?.name) || text(job?.companyName);
}

function workMode(value) {
	const displayed = displayText(value);
	const normalized = displayed.toLowerCase();
	if (normalized.includes("remote")) return "Remote";
	if (normalized.includes("hybrid")) return "Hybrid";
	if (normalized.includes("on-site") || normalized.includes("onsite") || normalized.includes("office")) {
		return "On-site";
	}
	return displayed || "Not specified";
}

function isoDate(value) {
	const raw = value?.toDate instanceof Function ? value.toDate() : value;
	const date = raw instanceof Date ? raw : new Date(raw || "");
	return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function httpUrl(value) {
	try {
		const raw = text(value);
		const url = new URL(raw.startsWith("//") ? `https:${raw}` : raw);
		return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
	} catch {
		return "";
	}
}

export function mapAthensLensJob(job, queueJob) {
	const details = job?.details && typeof job.details === "object" ? job.details : {};
	const title = text(job?.title) || text(queueJob?.title) || "Untitled role";
	const company = companyName(job) || text(queueJob?.company) || "Unknown company";
	const description = plainText(job?.jobDescription || job?.description);

	return {
		id: String(job?._id || queueJob?.jobId || ""),
		title,
		company,
		companyLogoUrl: httpUrl(job?.company?.logo || job?.companyIcon),
		location: displayText(job?.location) || displayText(details.position) || "Not specified",
		workMode: workMode(job?.workMode || details.remote),
		employmentType: displayText(job?.employmentType) || displayText(details.time) || "Not specified",
		seniority: displayText(job?.seniority) || displayText(details.seniority) || "Not specified",
		salary: displayText(job?.salary) || displayText(details.money) || "Undisclosed",
		experience: displayText(job?.experience) || displayText(details.date),
		postedAt: isoDate(job?.postedAt || job?._createdAt || job?.createdAt),
		skills: skillNames(job),
		tags: uniqueTextList(textList(job?.tags)),
		applicantsText: applicantsText(job?.applicants),
		description: description || "No job description has been provided.",
		responsibilities: textList(job?.responsibilities),
		qualifications: textList(job?.qualifications),
		applyUrl: httpUrl(job?.applyLink || job?.jobLink || queueJob?.applyUrl),
		bidReadyAt: isoDate(queueJob?.bidReadyDate),
	};
}

export async function listAthensLensJobs(applierName, { limit = 100 } = {}) {
	if (!jobsCollection) {
		throw Object.assign(new Error("Jobs are temporarily unavailable"), { status: 503 });
	}

	const boundedLimit = Math.max(1, Math.min(500, Number(limit) || 100));
	const applierId = await resolveApplierId(applierName);
	if (!applierId) return [];
	const idsByState = await readCanonicalProjectedJobStatusIdsByState(String(applierId), ["bid-ready"]);
	const jobIds = (idsByState.get("bid-ready") || []).slice(0, boundedLimit).map(String);
	if (!jobIds.length) return [];

	const ids = jobIds
		.map((jobId) => {
			try {
				return new DocumentId(jobId);
			} catch {
				return null;
			}
		})
		.filter(Boolean);
	const docs = await jobsCollection.find({ _id: { $in: ids } }, { projection: JOB_PROJECTION }).toArray();
	const byId = new Map(docs.map((job) => [String(job._id), job]));

	return jobIds.flatMap((jobId) => {
		const job = byId.get(jobId);
		return job ? [mapAthensLensJob(job, { jobId })] : [];
	});
}

export const athensLensJobsTest = { applicantsText, displayText, httpUrl, isoDate, plainText, skillNames, workMode };
