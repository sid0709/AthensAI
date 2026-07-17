
import { MongoClient } from "mongodb";
import {
	AI_API_USAGE_COLLECTION,
	ensureAiApiUsageIndexes,
} from "@nextoffer/shared/ai-api-usage";
import { ensureJobMarketIndexes, backfillMissingJobSourceFields, dedupeJobMarketByApplyLink } from "../services/jobMarketIndexes.js";
import { migrateAllExternalScrapedJobsToMarket } from "../services/promoteExternalJobToMarket.js";

let mongoClient;
let mongoCloudClient;
let jobsCollection;
let companyCategoryCollection;
let personalInfoCollection;
let accountInfoCollection;
/** Cloud mirror of `account_info` — writes/deletes are applied here too when configured. */
let accountInfoCloudCollection;
let cloudMirrorConfigured = false;
let cloudMirrorConnectError = null;
let rulesCollection;
let vendorTasksCollection;
let bidReviewEventsCollection;
let skillEnrichmentQueueCollection;
let skillCooccurrenceCollection;
let userKnowledgeGraphsCollection;
// Resume generator: saved config per applier + a history of generation runs.
// Always local (AthensDB) — this is the user's working data.
let resumeGeneratorConfigCollection;
let resumeGenerationsCollection;
let mailMessagesCollection;
let mailSyncStateCollection;
let mailUserLabelsCollection;
let userResumesCollection;
let resumeTemplatesCollection;
let avalonRunsCollection;
// Materialized per-user job match scores (fan-out on write) + rescore state.
let jobMatchScoresCollection;
let matchProfileStateCollection;
// Manual user skills with category + level — the sole source for match scoring.
let userSkillsCollection;
// Deduped global dictionary of every skill seen in a job description (AI-categorized).
let skillDictionaryCollection;
// 3rd-party scraped jobs ingested via the expose API (separate from job_market).
let externalScrapedJobsCollection;
/** Canonical AI spend ledger written by ai-bff. */
let aiApiUsageCollection;
/** @deprecated Alias — prefer aiApiUsageCollection */
let llmCallLogCollection;

async function ensureExternalScrapedJobsIndexes() {
	if (!externalScrapedJobsCollection) return;
	await externalScrapedJobsCollection.createIndex({ createdAt: -1 });
	await externalScrapedJobsCollection.createIndex({ sender: 1, createdAt: -1 });
	await externalScrapedJobsCollection.createIndex({ source: 1, createdAt: -1 });
	await externalScrapedJobsCollection.createIndex(
		{ jobLink: 1 },
		{ unique: true, partialFilterExpression: { jobLink: { $type: "string" } } },
	);
	await externalScrapedJobsCollection.createIndex(
		{ jobID: 1 },
		{ unique: true, partialFilterExpression: { jobID: { $type: "string" } } },
	);
	await externalScrapedJobsCollection.createIndex(
		{ aiSkillStatus: 1, createdAt: -1 },
		{ partialFilterExpression: { aiSkillStatus: "pending" } },
	);
	await externalScrapedJobsCollection.createIndex(
		{ matchScoreStatus: 1, createdAt: -1 },
		{ partialFilterExpression: { matchScoreStatus: "pending" } },
	);
}

async function ensureMailCollectionsIndexes() {
	if (mailMessagesCollection) {
		// UID is unique per IMAP mailbox, not globally — include mailbox in the key.
		try {
			await mailMessagesCollection.dropIndex('applierName_1_uid_1');
		} catch {
			// Index may not exist on fresh DBs.
		}
		await mailMessagesCollection.createIndex(
			{ applierName: 1, mailbox: 1, uid: 1 },
			{ unique: true },
		);
		await mailMessagesCollection.createIndex({ applierName: 1, date: -1 });
		await mailMessagesCollection.createIndex({ applierName: 1, folder: 1, date: -1 });
	}
	if (mailSyncStateCollection) {
		await mailSyncStateCollection.createIndex({ applierName: 1 }, { unique: true });
	}
	if (mailUserLabelsCollection) {
		await mailUserLabelsCollection.createIndex({ applierName: 1 }, { unique: true });
	}
}

async function ensureSkillCollectionsIndexes() {
	if (skillEnrichmentQueueCollection) {
		await skillEnrichmentQueueCollection.createIndex({ normalizedKey: 1 }, { unique: true });
		await skillEnrichmentQueueCollection.createIndex({ status: 1, createdAt: 1 });
	}
	if (skillCooccurrenceCollection) {
		await skillCooccurrenceCollection.createIndex({ pairKey: 1 }, { unique: true });
		await skillCooccurrenceCollection.createIndex({ count: -1 });
	}
	if (personalInfoCollection) {
		await personalInfoCollection.createIndex({ name: 1 }, { unique: true });
		await personalInfoCollection.createIndex({ canonicalId: 1 });
	}
	if (userKnowledgeGraphsCollection) {
		await userKnowledgeGraphsCollection.createIndex({ applierName: 1, resumeId: 1 }, { unique: true });
		await userKnowledgeGraphsCollection.createIndex({ applierName: 1, updatedAt: -1 });
	}
	if (userResumesCollection) {
		await userResumesCollection.createIndex({ ownerId: 1, techStack: 1 });
		await userResumesCollection.createIndex({ ownerName: 1, uploadedAt: -1 });
		await userResumesCollection.createIndex({ ownerName: 1, analyzed: 1 });
	}
	if (resumeTemplatesCollection) {
		await resumeTemplatesCollection.createIndex({ ownerName: 1, uploadedAt: -1 });
	}
	if (jobsCollection) {
		await jobsCollection.createIndex({ 'skillAnalysis.status': 1, 'skillAnalysis.queuedAt': 1 });
	}
}

async function ensureMatchScoreIndexes() {
	if (jobMatchScoresCollection) {
		// jobId completes the list-sort key so pagination is deterministic AND
		// the sort stays a pure index scan (no in-memory SORT stage).
		await jobMatchScoresCollection.createIndex({ applierName: 1, score: -1, postedAt: -1, jobId: -1 });
		await jobMatchScoresCollection.createIndex({ applierName: 1, jobId: 1 }, { unique: true });
		await jobMatchScoresCollection.createIndex({ jobId: 1 });
		await jobMatchScoresCollection.createIndex({ applierName: 1, profileVersion: 1 });
	}
	if (matchProfileStateCollection) {
		await matchProfileStateCollection.createIndex({ applierName: 1 }, { unique: true });
		await matchProfileStateCollection.createIndex({ status: 1, requestedAt: 1 });
	}
	if (userSkillsCollection) {
		await userSkillsCollection.createIndex({ applierName: 1, nameCanonical: 1 }, { unique: true });
		await userSkillsCollection.createIndex({ applierName: 1, category: 1, level: -1 });
	}
	if (skillDictionaryCollection) {
		await skillDictionaryCollection.createIndex({ nameCanonical: 1 }, { unique: true });
		await skillDictionaryCollection.createIndex({ tokens: 1 });
		await skillDictionaryCollection.createIndex({ jobCount: -1 });
	}
}

async function initMongo() {
	const mongoUrl = process.env.MONGO_URL;
	if (!mongoUrl) {
		throw new Error(
			'MONGO_URL is not set. Copy .env.example to .env and set MONGO_URL (e.g. mongodb://127.0.0.1:27017).'
		);
	}
	const mongoDbName = process.env.MONGO_DB;

	if(!mongoDbName) {
		throw new Error(
			'MONGO_DB is not set. Copy .env.example to .env and set MONGO_DB (e.g. AthensDB).'
		);
	}

	mongoClient = new MongoClient(mongoUrl);
	await mongoClient.connect();
	const db = mongoClient.db(mongoDbName);
	jobsCollection = db.collection('job_market');
	companyCategoryCollection = db.collection('company_category');
	personalInfoCollection = db.collection('personal_info');
	skillEnrichmentQueueCollection = db.collection('skill_enrichment_queue');
	skillCooccurrenceCollection = db.collection('skill_cooccurrence');
	userKnowledgeGraphsCollection = db.collection('user_knowledge_graphs');
	accountInfoCollection = db.collection('account_info');
	rulesCollection = db.collection('rules');
	resumeGeneratorConfigCollection = db.collection('resume_generator_config');
	resumeGenerationsCollection = db.collection('resume_generations');
	mailMessagesCollection = db.collection('mail_messages');
	mailSyncStateCollection = db.collection('mail_sync_state');
	mailUserLabelsCollection = db.collection('mail_user_labels');
	userResumesCollection = db.collection('user_resumes');
	resumeTemplatesCollection = db.collection('resume_templates');
	avalonRunsCollection = db.collection('avalon_apply_runs');
	jobMatchScoresCollection = db.collection('job_match_scores');
	matchProfileStateCollection = db.collection('match_profile_state');
	userSkillsCollection = db.collection('user_skills');
	skillDictionaryCollection = db.collection('skill_dictionary');
	externalScrapedJobsCollection = db.collection('external_scraped_jobs');
	aiApiUsageCollection = db.collection(AI_API_USAGE_COLLECTION);
	llmCallLogCollection = aiApiUsageCollection;
	try {
		await ensureAiApiUsageIndexes(aiApiUsageCollection);
	} catch (err) {
		console.warn('[ai_api_usage] index creation failed:', err.message);
	}
	try {
		await avalonRunsCollection.createIndex({ runId: 1 }, { unique: true });
		await avalonRunsCollection.createIndex({ applierName: 1, startedAt: -1 });
		await avalonRunsCollection.createIndex({ 'job.id': 1, startedAt: -1 });
	} catch (err) {
		console.warn('[avalon_apply_runs] index creation failed:', err.message);
	}
	await ensureJobMarketIndexes(jobsCollection);
	await ensureSkillCollectionsIndexes();
	await ensureMailCollectionsIndexes();
	await ensureMatchScoreIndexes();
	await ensureExternalScrapedJobsIndexes();
	// Remove pre-existing duplicate applyLink jobs, then enforce uniqueness so
	// no duplicate links can be inserted afterward. Index creation must run only
	// after the cleanup completes, otherwise it would fail on existing dupes.
	try {
		await dedupeJobMarketByApplyLink(jobsCollection);
		await jobsCollection.createIndex(
			{ applyLink: 1 },
			{ unique: true, partialFilterExpression: { applyLink: { $type: 'string' } } },
		);
	} catch (err) {
		console.warn('[job_market] applyLink dedupe/index failed', err.message);
	}
	void backfillMissingJobSourceFields(jobsCollection).catch((err) => {
		console.warn('[job_market] source field backfill failed', err.message);
	});
	// Promote historical external_scraped_jobs into job_market (idempotent).
	// Fire-and-forget so Docker `npm start` is not blocked on large catalogs.
	void migrateAllExternalScrapedJobsToMarket().catch((err) => {
		console.warn('[migrate-external→market] startup migrate failed', err.message);
	});
	console.log('Connected to MongoDB', mongoUrl, 'DB:', mongoDbName);

	vendorTasksCollection = db.collection('vendor_tasks');
	bidReviewEventsCollection = db.collection('bid_review_events');
	try {
		await vendorTasksCollection.createIndex({ applierName: 1, addedAt: -1 });
		await vendorTasksCollection.createIndex(
			{ applierName: 1, jobId: 1 },
			{ unique: true, partialFilterExpression: { jobId: { $type: 'string' } } },
		);
		await vendorTasksCollection.createIndex(
			{ applierName: 1, applyUrl: 1 },
			{ unique: true, partialFilterExpression: { applyUrl: { $type: 'string' } } },
		);
		await vendorTasksCollection.createIndex({ applierName: 1, reviewStatus: 1, updatedAt: -1 });
	} catch (err) {
		console.warn('[vendor_tasks] index creation failed', err.message);
	}
	try {
		await bidReviewEventsCollection.createIndex({ applierName: 1, taskId: 1, createdAt: 1 });
		await bidReviewEventsCollection.createIndex({ applierName: 1, jobId: 1, createdAt: 1 });
		await bidReviewEventsCollection.createIndex({ applierName: 1, eventType: 1, createdAt: -1 });
	} catch (err) {
		console.warn('[bid_review_events] index creation failed', err.message);
	}

	const mongoCloudUrl = process.env.MONGO_CLOUD_URL?.trim();
	if (mongoCloudUrl) {
		cloudMirrorConfigured = true;
		try {
			mongoCloudClient = new MongoClient(mongoCloudUrl);
			await mongoCloudClient.connect();
			const cloudDb = mongoCloudClient.db(mongoDbName);
			accountInfoCloudCollection = cloudDb.collection('account_info');
			console.log('Connected to cloud MongoDB (account_info mirror)', mongoDbName);
		} catch (err) {
			cloudMirrorConnectError = err instanceof Error ? err.message : String(err);
			console.error('Cloud MongoDB connection failed — account_info will save locally only until fixed:', cloudMirrorConnectError);
			if (mongoCloudClient) {
				try {
					await mongoCloudClient.close();
				} catch {
					// ignore
				}
				mongoCloudClient = null;
			}
			accountInfoCloudCollection = null;
		}
	} else {
		console.log('MONGO_CLOUD_URL not set — account_info writes go to local only');
	}

}

function getVendorTasksCollection() {
	return vendorTasksCollection || null;
}

function getBidReviewEventsCollection() {
	return bidReviewEventsCollection || null;
}

function isCloudMirrorConfigured() {
	return cloudMirrorConfigured;
}

function getCloudMirrorStatus() {
	return {
		configured: cloudMirrorConfigured,
		connected: Boolean(accountInfoCloudCollection),
		error: cloudMirrorConnectError,
	};
}

async function closeMongo() {
	if (mongoClient) {
		await mongoClient.close();
		mongoClient = null;
	}
	if (mongoCloudClient) {
		await mongoCloudClient.close();
		mongoCloudClient = null;
	}
	accountInfoCloudCollection = null;
	vendorTasksCollection = null;
	bidReviewEventsCollection = null;
	cloudMirrorConfigured = false;
	cloudMirrorConnectError = null;
}

export {
	initMongo,
	jobsCollection,
	companyCategoryCollection,
	personalInfoCollection,
	skillEnrichmentQueueCollection,
	skillCooccurrenceCollection,
	userKnowledgeGraphsCollection,
	accountInfoCollection,
	accountInfoCloudCollection,
	isCloudMirrorConfigured,
	getCloudMirrorStatus,
	getVendorTasksCollection,
	getBidReviewEventsCollection,
	rulesCollection,
	vendorTasksCollection,
	bidReviewEventsCollection,
	resumeGeneratorConfigCollection,
	resumeGenerationsCollection,
	mailMessagesCollection,
	mailSyncStateCollection,
	mailUserLabelsCollection,
	userResumesCollection,
	resumeTemplatesCollection,
	avalonRunsCollection,
	jobMatchScoresCollection,
	matchProfileStateCollection,
	userSkillsCollection,
	skillDictionaryCollection,
	externalScrapedJobsCollection,
	aiApiUsageCollection,
	llmCallLogCollection,
	closeMongo
};
