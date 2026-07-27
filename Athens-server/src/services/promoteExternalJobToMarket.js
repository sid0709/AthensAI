import {
	jobsCollection,
	externalScrapedJobsCollection,
	jobIdentityRegistryCollection,
	companiesCollection,
	companyAliasesCollection,
} from "../db/mongo.js";
import { JOB_MARKET_MODEL_VERSION } from "../config/jobMarketSchema.js";
import { inferJobSource, SOURCE_MAP_VERSION } from "../config/jobSources.js";
import { attachStaticScoreFields } from "./jobListPipeline.js";
import { indexJobInRedis } from "./matching/skillIndex.js";
import { indexOneJobRanking } from "./matching/jobRankingIndex.js";
import {
	claimJobIdentity,
	finalizeJobIdentityClaim,
	findRecentJobIdentityDuplicate,
	releaseJobIdentityClaim,
	resolveJobAcceptedAt,
} from "./jobIdentityDedupe.js";
import {
	applyCompanyIdentity,
	deriveCompanyIdentity,
	resolveCompanyIdentity,
} from "./companyIdentity.js";

const clean = (value) => String(value ?? "").trim();

/** Link-derived source fields for external_scraped_jobs documents. */
export function externalSourceFieldsFromLink(jobLink) {
	return {
		source: inferJobSource(jobLink),
		sourceVersion: SOURCE_MAP_VERSION,
	};
}

/**
 * Map an external_scraped_jobs document to a job_market insert payload.
 * Copies AI enrichment when already extracted; otherwise queues both pipelines.
 */
export function mapExternalDocToMarketJob(externalDoc) {
	if (!externalDoc || typeof externalDoc !== "object") {
		throw new Error("externalDoc is required");
	}

	const applyLink = clean(externalDoc.jobLink || externalDoc.applyLink);
	if (!applyLink) throw new Error("externalDoc.jobLink is required");

	const createdRaw = externalDoc.createdAt || externalDoc.updatedAt || new Date();
	const createdAtIso =
		createdRaw instanceof Date ? createdRaw.toISOString() : new Date(createdRaw).toISOString();
	const postedAtRaw = externalDoc.postedAt || createdRaw;
	const postedAt =
		postedAtRaw instanceof Date
			? postedAtRaw.toISOString()
			: typeof postedAtRaw === "string" && postedAtRaw.trim()
				? postedAtRaw.trim()
				: createdAtIso;

	const enrichedCompany =
		externalDoc.company && typeof externalDoc.company === "object"
			? {
					name:
						clean(externalDoc.company.name) ||
						clean(externalDoc.companyName) ||
						"Unknown",
					...(clean(externalDoc.company.logo) || clean(externalDoc.companyIcon)
						? {
								logo:
									clean(externalDoc.company.logo) ||
									clean(externalDoc.companyIcon),
							}
						: {}),
					tags: Array.isArray(externalDoc.company.tags) ? externalDoc.company.tags : [],
				}
			: {
					name: clean(externalDoc.companyName) || "Unknown",
					...(clean(externalDoc.companyIcon)
						? { logo: clean(externalDoc.companyIcon) }
						: {}),
					tags: [],
				};

	const description = clean(externalDoc.description || externalDoc.jobDescription);
	const jobDescription = clean(externalDoc.jobDescription || externalDoc.description);
	const extracted = externalDoc.aiSkillStatus === "extracted";

	const job = {
		title: clean(externalDoc.title || externalDoc.jobTitle) || "Untitled role",
		company: enrichedCompany,
		details:
			externalDoc.details && typeof externalDoc.details === "object"
				? externalDoc.details
				: {},
		description,
		jobDescription,
		applyLink,
		companyLink: clean(externalDoc.companyLink),
		postedAt,
		_createdAt: createdAtIso,
		modelVersion: JOB_MARKET_MODEL_VERSION,
		externalRef: {
			...(clean(externalDoc.sender) ? { sender: clean(externalDoc.sender) } : {}),
			...(clean(externalDoc.jobID) ? { jobID: clean(externalDoc.jobID) } : {}),
			...(externalDoc._id != null ? { id: String(externalDoc._id) } : {}),
		},
		aiSkillStatus: extracted ? "extracted" : "pending",
		matchScoreStatus: "pending",
	};

	const postedAgo = clean(externalDoc.postedAgo);
	if (postedAgo) job.postedAgo = postedAgo;

	if (extracted) {
		for (const key of [
			"aiSkills",
			"skills",
			"skillsNormalized",
			"skillTokens",
			"aiSkillsHash",
			"aiSkillExtractedAt",
		]) {
			if (externalDoc[key] !== undefined) job[key] = externalDoc[key];
		}
	}

	Object.assign(job, attachStaticScoreFields(job));
	applyCompanyIdentity(job, deriveCompanyIdentity(job, { seed: externalDoc._id || externalDoc.jobID || applyLink }));
	return job;
}

/**
 * Promote one external row into job_market when applyLink is absent there.
 * Updates external source from the link and marks it skipped_duplicate when
 * a market row exists or is created.
 *
 * @returns {{ promoted: boolean, skippedExisting?: boolean, marketId?: import('mongodb').ObjectId, source: string }}
 */
export async function promoteExternalJobToMarket(externalDoc, {
	dryRun = false,
	identityClaim = null,
	marketCollection = jobsCollection,
	externalCollection = externalScrapedJobsCollection,
	identityRegistry = jobIdentityRegistryCollection,
	companyRegistry = companiesCollection,
	companyAliases = companyAliasesCollection,
} = {}) {
	if (!marketCollection) throw new Error("Database not ready");
	if (!externalDoc?._id) throw new Error("externalDoc._id is required");

	const applyLink = clean(externalDoc.jobLink || externalDoc.applyLink);
	if (!applyLink) throw new Error("externalDoc.jobLink is required");

	const sourceFields = externalSourceFieldsFromLink(applyLink);

	if (!dryRun && externalCollection) {
		await externalCollection.updateOne(
			{ _id: externalDoc._id },
			{ $set: { ...sourceFields, updatedAt: new Date() } },
		);
	}

	const existing = await marketCollection.findOne(
		{ applyLink },
		{ projection: { _id: 1 } },
	);

	if (existing) {
		if (identityClaim?.claimed) {
			await releaseJobIdentityClaim(identityRegistry, identityClaim);
		}
		if (!dryRun && externalCollection) {
			await markExternalSkippedDuplicate(externalCollection, externalDoc._id);
		}
		return {
			promoted: false,
			skippedExisting: true,
			duplicate: true,
			reason: "Duplicate job URL already exists",
			marketId: existing._id,
			source: sourceFields.source,
		};
	}

	const marketJob = mapExternalDocToMarketJob({
		...externalDoc,
		...sourceFields,
	});
	applyCompanyIdentity(marketJob, await resolveCompanyIdentity(marketJob, {
		companiesCollection: companyRegistry,
		companyAliasesCollection: companyAliases,
		seed: externalDoc._id || externalDoc.jobID || applyLink,
		persist: !dryRun,
	}));

	if (dryRun) {
		const duplicate = await findRecentJobIdentityDuplicate(identityRegistry, {
			companyName: marketJob.company?.name,
			title: marketJob.title,
			acceptedAt: resolveJobAcceptedAt(marketJob, new Date()),
		});
		if (duplicate) {
			return {
				promoted: false,
				skippedExisting: true,
				duplicate: true,
				reason: "Duplicate job with this company and title was added within the last 30 days",
				source: sourceFields.source,
			};
		}
		return { promoted: true, dryRun: true, source: sourceFields.source };
	}

	let activeClaim = identityClaim;
	if (!activeClaim) {
		activeClaim = await claimJobIdentity(identityRegistry, {
			companyName: marketJob.company?.name,
			title: marketJob.title,
			acceptedAt: resolveJobAcceptedAt(marketJob, new Date()),
			source: "exposed-api",
		});
	}
	if (activeClaim?.duplicate) {
		if (externalCollection) {
			await markExternalSkippedDuplicate(externalCollection, externalDoc._id);
		}
		return {
			promoted: false,
			skippedExisting: true,
			duplicate: true,
			reason: "Duplicate job with this company and title was added within the last 30 days",
			source: sourceFields.source,
		};
	}

	let insertedId;
	try {
		const result = await marketCollection.insertOne(marketJob);
		insertedId = result.insertedId;
	} catch (err) {
		if (err?.code === 11000) {
			await releaseJobIdentityClaim(identityRegistry, activeClaim);
			const raced = await marketCollection.findOne(
				{ applyLink },
				{ projection: { _id: 1 } },
			);
			if (externalCollection) {
				await markExternalSkippedDuplicate(externalCollection, externalDoc._id);
			}
			return {
				promoted: false,
				skippedExisting: true,
				duplicate: true,
				reason: "Duplicate job URL already exists",
				marketId: raced?._id,
				source: sourceFields.source,
			};
		}
		await releaseJobIdentityClaim(identityRegistry, activeClaim);
		throw err;
	}

	await finalizeJobIdentityClaim(identityRegistry, activeClaim, {
		jobId: insertedId,
		source: "exposed-api",
	}).catch((error) => {
		console.warn('[job-identity] finalize external promotion failed:', error?.message || error);
	});

	if (marketJob.skillsNormalized || marketJob.skillTokens) {
		void indexJobInRedis(
			String(insertedId),
			marketJob.skillsNormalized,
			marketJob.skillTokens,
		).catch(() => {});
	}
	void indexOneJobRanking({ ...marketJob, _id: insertedId }).catch(() => {});

	if (externalCollection) {
		await markExternalSkippedDuplicate(externalCollection, externalDoc._id).catch((error) => {
			console.warn('[expose/jobs] failed to mark promoted external row:', error?.message || error);
		});
	}

	return {
		promoted: true,
		marketId: insertedId,
		source: sourceFields.source,
	};
}

async function markExternalSkippedDuplicate(collection, externalId) {
	await collection.updateOne(
		{ _id: externalId },
		{
			$set: {
				aiSkillStatus: "skipped_duplicate",
				matchScoreStatus: "scored",
				updatedAt: new Date(),
			},
		},
	);
}

/**
 * Idempotent full-catalog promote: fix source on every external row and insert
 * missing jobs into job_market. Safe to run on every server boot.
 */
export async function migrateAllExternalScrapedJobsToMarket({ dryRun = false } = {}) {
	if (!externalScrapedJobsCollection || !jobsCollection) {
		return { scanned: 0, promoted: 0, skippedExisting: 0, errors: 0, skipped: true };
	}

	let scanned = 0;
	let promoted = 0;
	let skippedExisting = 0;
	let errors = 0;

	const cursor = externalScrapedJobsCollection.find({});
	for await (const doc of cursor) {
		scanned += 1;
		try {
			const result = await promoteExternalJobToMarket(doc, { dryRun });
			if (result.promoted) promoted += 1;
			else if (result.skippedExisting) skippedExisting += 1;
		} catch (err) {
			errors += 1;
			console.error(
				`[migrate-external→market] failed ${doc._id} (${doc.jobLink}):`,
				err?.message || err,
			);
		}
	}

	if (scanned || promoted || errors) {
		console.log(
			`[migrate-external→market] done — scanned=${scanned}, promoted=${promoted}, ` +
				`skippedExisting=${skippedExisting}, errors=${errors}` +
				(dryRun ? " (dry run, no writes)" : ""),
		);
	}

	return { scanned, promoted, skippedExisting, errors };
}
