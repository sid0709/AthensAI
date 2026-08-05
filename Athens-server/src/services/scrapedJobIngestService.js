import {
	externalScrapedJobsCollection,
	jobIdentityRegistryCollection,
	jobsCollection,
} from "../db/dataStore.js";
import { JOB_MARKET_MODEL_VERSION } from "../config/jobMarketSchema.js";
import {
	externalSourceFieldsFromLink,
	promoteExternalJobToMarket as promoteExternalJobToMarketDefault,
} from "./promoteExternalJobToMarket.js";
import { findDuplicateByUrl } from "./jobDuplicateLookup.js";
import {
	claimJobIdentity,
	releaseJobIdentityClaim,
} from "./jobIdentityDedupe.js";

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

export async function ingestScrapedJob(job, {
	externalCollection = externalScrapedJobsCollection,
	marketCollection = jobsCollection,
	identityRegistry = jobIdentityRegistryCollection,
	promoteExternalJobToMarket = promoteExternalJobToMarketDefault,
} = {}) {
	const now = new Date();
	const sourceFields = externalSourceFieldsFromLink(job.jobLink);
	const doc = {
		...job,
		...sourceFields,
		catalog: "external",
		modelVersion: JOB_MARKET_MODEL_VERSION,
		aiSkillStatus: "pending",
		createdAt: now,
		updatedAt: now,
	};
	let identityClaim = null;
	let insertedExternalId = null;

	try {
		const existingByUrl = await findDuplicateByUrl(marketCollection, [job.jobLink]);
		if (existingByUrl) {
			return {
				created: false,
				duplicate: true,
				reason: "Duplicate job URL already exists",
				jobID: job.jobID,
				jobLink: job.jobLink,
			};
		}

		identityClaim = await claimJobIdentity(identityRegistry, {
			companyName: job.companyName,
			title: job.jobTitle,
			acceptedAt: now,
			source: "exposed-api",
		});
		if (identityClaim.duplicate) {
			return {
				created: false,
				duplicate: true,
				reason: "Duplicate job with this company and title was added within the last 30 days",
				jobID: job.jobID,
				jobLink: job.jobLink,
			};
		}

		const result = await externalCollection.insertOne(doc);
		insertedExternalId = result.insertedId;
		const inserted = { ...doc, _id: result.insertedId };
		const promote = await promoteExternalJobToMarket(inserted, {
			identityClaim,
			marketCollection,
			externalCollection,
			identityRegistry,
		});
		if (!promote.promoted) {
			await externalCollection.deleteOne({ _id: result.insertedId });
			insertedExternalId = null;
			return {
				created: false,
				duplicate: true,
				reason: promote.reason || "Duplicate job already exists",
				jobID: job.jobID,
				jobLink: job.jobLink,
			};
		}

		return {
			created: true,
			id: result.insertedId,
			jobID: job.jobID,
			jobLink: job.jobLink,
			source: sourceFields.source,
			...(promote.marketId ? { marketId: promote.marketId } : {}),
		};
	} catch (err) {
		if (identityClaim?.claimed) {
			await releaseJobIdentityClaim(identityRegistry, identityClaim).catch(() => {});
		}
		if (insertedExternalId) {
			await externalCollection.deleteOne({ _id: insertedExternalId }).catch((cleanupError) => {
				console.warn('[expose/jobs] failed to clean up unpromoted external row:', cleanupError?.message || cleanupError);
			});
		}
		if (err?.code === 11000) {
			return {
				created: false,
				duplicate: true,
				reason: "Duplicate external job ID or URL already exists",
				jobID: job.jobID,
				jobLink: job.jobLink,
			};
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

export async function ingestScrapedJobs(jobs, options = {}) {
	const results = [];
	for (const job of jobs) {
		results.push(await ingestScrapedJob(job, options));
	}
	return results;
}
