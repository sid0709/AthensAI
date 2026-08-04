import { DocumentId } from "@nextoffer/shared/document-id";
import { jobsCollection } from "../db/dataStore.js";
import { listBidQueueJobs } from "./jobBidStatusService.js";

const JOB_PROJECTION = {
	title: 1,
	company: 1,
	companyName: 1,
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

function companyName(job) {
	if (typeof job?.company === "string") return text(job.company);
	return text(job?.company?.name) || text(job?.companyName);
}

function workMode(value) {
	const normalized = text(value).toLowerCase();
	if (normalized.includes("remote")) return "Remote";
	if (normalized.includes("hybrid")) return "Hybrid";
	if (normalized.includes("on-site") || normalized.includes("onsite") || normalized.includes("office")) {
		return "On-site";
	}
	return text(value) || "Not specified";
}

function isoDate(value) {
	const raw = value?.toDate instanceof Function ? value.toDate() : value;
	const date = raw instanceof Date ? raw : new Date(raw || "");
	return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function httpUrl(value) {
	try {
		const url = new URL(text(value));
		return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
	} catch {
		return "";
	}
}

function summarize(description, title, company) {
	if (!description) return `${title} at ${company}.`;
	if (description.length <= 180) return description;
	const shortened = description.slice(0, 181);
	const lastSpace = shortened.lastIndexOf(" ");
	return `${shortened.slice(0, lastSpace > 120 ? lastSpace : 180).trimEnd()}…`;
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
		location: text(job?.location) || text(details.position) || "Not specified",
		workMode: workMode(job?.workMode || details.remote),
		employmentType: text(job?.employmentType) || text(details.time) || "Not specified",
		postedAt: isoDate(job?.postedAt || job?._createdAt || job?.createdAt),
		summary: summarize(description, title, company),
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
	const queued = await listBidQueueJobs(applierName, {
		limit: boundedLimit,
		includeCompleted: false,
	});
	if (!queued.length) return [];

	const ids = queued
		.map((job) => {
			try {
				return new DocumentId(String(job.jobId));
			} catch {
				return null;
			}
		})
		.filter(Boolean);
	const docs = await jobsCollection.find({ _id: { $in: ids } }, { projection: JOB_PROJECTION }).toArray();
	const byId = new Map(docs.map((job) => [String(job._id), job]));

	return queued.flatMap((queueJob) => {
		const job = byId.get(String(queueJob.jobId));
		return job ? [mapAthensLensJob(job, queueJob)] : [];
	});
}

export const athensLensJobsTest = { httpUrl, isoDate, plainText, summarize, workMode };
