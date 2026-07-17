import { externalScrapedJobsCollection } from "../db/mongo.js";
import { JOB_MARKET_MODEL_VERSION } from "../config/jobMarketSchema.js";
import {
	externalSourceFieldsFromLink,
	promoteExternalJobToMarket,
} from "./promoteExternalJobToMarket.js";

const clean = (value) => String(value ?? "").trim();

const isHttpUrl = (value) => {
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:";
	} catch {
		return false;
	}
};

/**
 * Normalize and validate one scraped job payload from a 3rd-party integrator.
 * Client `source` is ignored — source is derived from jobLink on ingest.
 * @returns {{ ok: true, job: object } | { ok: false, error: string }}
 */
export function validateScrapedJobInput(raw) {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		return { ok: false, error: "Request body must be a JSON object" };
	}

	const companyName = clean(raw.companyName ?? raw.company_name);
	const companyIcon = clean(raw.companyIcon ?? raw.company_icon);
	const jobTitle = clean(raw.jobTitle ?? raw.job_title ?? raw.title);
	const jobDescription = clean(raw.jobDescription ?? raw.job_description ?? raw.description);
	const jobLink = clean(raw.jobLink ?? raw.job_link ?? raw.applyLink ?? raw.url);
	const jobID = clean(raw.jobID ?? raw.job_id ?? raw.jobId);
	const sender = clean(raw.sender ?? raw.Sender);
	const postedAgo = clean(raw.postedAgo ?? raw.posted_ago ?? raw.postedAt);

	if (!companyName) return { ok: false, error: "companyName is required" };
	if (!jobID) return { ok: false, error: "jobID is required" };
	if (!sender) return { ok: false, error: "sender is required" };
	if (!jobTitle) return { ok: false, error: "jobTitle is required" };
	if (!jobDescription) return { ok: false, error: "jobDescription is required" };
	if (!jobLink) return { ok: false, error: "jobLink is required" };
	if (!isHttpUrl(jobLink)) return { ok: false, error: "jobLink must be a valid http(s) URL" };
	if (companyIcon && !isHttpUrl(companyIcon)) {
		return { ok: false, error: "companyIcon must be a valid http(s) URL when provided" };
	}

	return {
		ok: true,
		job: {
			sender,
			jobID,
			companyName,
			companyIcon,
			jobTitle,
			jobDescription,
			jobLink,
			...(postedAgo ? { postedAgo } : {}),
		},
	};
}

export async function ingestScrapedJob(job) {
	const now = new Date();
	const sourceFields = externalSourceFieldsFromLink(job.jobLink);
	const doc = {
		...job,
		...sourceFields,
		catalog: "external",
		modelVersion: JOB_MARKET_MODEL_VERSION,
		aiSkillStatus: "pending",
		matchScoreStatus: "pending",
		createdAt: now,
		updatedAt: now,
	};

	try {
		const result = await externalScrapedJobsCollection.insertOne(doc);
		const inserted = { ...doc, _id: result.insertedId };

		let marketId = null;
		try {
			const promote = await promoteExternalJobToMarket(inserted);
			marketId = promote.marketId ?? null;
		} catch (promoteErr) {
			console.error(
				`[expose/jobs] promote to job_market failed for ${job.jobID}:`,
				promoteErr?.message || promoteErr,
			);
		}

		return {
			created: true,
			id: result.insertedId,
			jobID: job.jobID,
			jobLink: job.jobLink,
			source: sourceFields.source,
			...(marketId ? { marketId } : {}),
		};
	} catch (err) {
		if (err?.code === 11000) {
			return { created: false, duplicate: true, jobID: job.jobID, jobLink: job.jobLink };
		}
		throw err;
	}
}

export async function scrapedJobExistsByJobId(jobID) {
	const id = clean(jobID);
	if (!id) return false;
	const doc = await externalScrapedJobsCollection.findOne(
		{ jobID: id },
		{ projection: { _id: 1 } },
	);
	return Boolean(doc);
}

export async function ingestScrapedJobs(jobs) {
	const results = [];
	for (const job of jobs) {
		results.push(await ingestScrapedJob(job));
	}
	return results;
}
