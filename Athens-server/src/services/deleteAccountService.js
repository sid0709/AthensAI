/**
 * Full account wipe: profile, résumés, agent history, bid data, mail, disk, Firebase, Qdrant.
 * Login identity is account_info.name (applierName).
 */
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	accountInfoCollection,
	jobsCollection,
	userResumesCollection,
	resumeTemplatesCollection,
	resumeGenerationsCollection,
	resumeGeneratorConfigCollection,
	userKnowledgeGraphsCollection,
	userSkillsCollection,
	jobMatchScoresCollection,
	matchProfileStateCollection,
	mailMessagesCollection,
	mailSyncStateCollection,
	mailUserLabelsCollection,
	avalonRunsCollection,
	aiApiUsageCollection,
	getMongoDb,
	getVendorTasksCollection,
	getBidReviewEventsCollection,
} from "../db/mongo.js";
import { deleteAccountInfoByName } from "./accountInfoStore.js";
import { clearJobBidStatus, listBidQueueJobs } from "./jobBidStatusService.js";
import { deleteScoresForApplier } from "./matching/matchScoreStore.js";
import { invalidateRecommendationCache } from "./matching/matchingService.js";
import { removeResumeEmbedding } from "./embeddings/embeddingIngest.js";
import { deleteProfileVector } from "./vectorStore/qdrantClient.js";
import { deleteStoredObject } from "./firebase/objectStore.js";

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
/** Matches chromeProfilesController: repo root (parent of Athens-server). */
const REPO_ROOT = path.resolve(SERVER_ROOT, "..");

function cleanName(value) {
	return String(value ?? "").trim();
}

function safeApplierFs(name) {
	return String(name || "").replace(/[^\w.\- ]+/g, "_").slice(0, 80) || "applier";
}

function safeApplierChrome(name) {
	return String(name || "").replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "applicant";
}

function slugifyFirebase(value) {
	return (
		String(value || "unknown")
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 64) || "unknown"
	);
}

async function purgeUserResumes(ownerName) {
	if (!userResumesCollection) return { resumes: 0, objects: 0 };
	const docs = await userResumesCollection.find({ ownerName }).toArray();
	let objects = 0;
	for (const doc of docs) {
		if (await deleteStoredObject(doc, { collection: userResumesCollection, legacyDb: getMongoDb(), legacyBucketName: "user_resume_files" })) objects += 1;
		void removeResumeEmbedding(String(doc._id)).catch(() => {});
	}
	const res = await userResumesCollection.deleteMany({ ownerName });
	try {
		await deleteProfileVector(ownerName);
	} catch {
		/* qdrant optional */
	}
	return { resumes: res.deletedCount ?? 0, objects };
}

async function purgeResumeTemplates(ownerName) {
	if (!resumeTemplatesCollection) return { templates: 0, objects: 0 };
	const docs = await resumeTemplatesCollection.find({ ownerName }).toArray();
	let objects = 0;
	for (const doc of docs) {
		if (await deleteStoredObject(doc, { collection: resumeTemplatesCollection, legacyDb: getMongoDb(), legacyBucketName: "resume_template_files" })) objects += 1;
	}
	const res = await resumeTemplatesCollection.deleteMany({ ownerName });
	return { templates: res.deletedCount ?? 0, objects };
}

async function purgeMailMessages(ownerName) {
	if (!mailMessagesCollection) return { messages: 0, objects: 0 };
	const docs = await mailMessagesCollection.find({ applierName: ownerName }).toArray();
	let objects = 0;
	for (const doc of docs) {
		const candidates = [doc.bodyObject, doc.bodyText?.object, doc.bodyHtml?.object].filter(Boolean);
		for (const object of candidates) {
			if (await deleteStoredObject({ object })) objects += 1;
		}
	}
	const result = await mailMessagesCollection.deleteMany({ applierName: ownerName });
	return { messages: result.deletedCount ?? 0, objects };
}

async function purgeVendorAndBids(applierName) {
	const tasks = getVendorTasksCollection();
	const events = getBidReviewEventsCollection();
	const jobIds = new Set();

	if (tasks) {
		const docs = await tasks.find({ applierName }).project({ jobId: 1 }).toArray();
		for (const d of docs) {
			if (d.jobId) jobIds.add(String(d.jobId));
		}
	}
	try {
		const queueJobs = await listBidQueueJobs(applierName, { limit: 5000, includeCompleted: true });
		for (const job of queueJobs) jobIds.add(String(job.jobId));
	} catch {
		/* ignore */
	}

	const taskResult = tasks ? await tasks.deleteMany({ applierName }) : { deletedCount: 0 };
	const eventResult = events ? await events.deleteMany({ applierName }) : { deletedCount: 0 };

	await Promise.all([...jobIds].map((jobId) => clearJobBidStatus(applierName, jobId).catch(() => {})));

	return {
		vendorTasks: taskResult.deletedCount ?? 0,
		bidEvents: eventResult.deletedCount ?? 0,
		clearedJobs: jobIds.size,
	};
}

async function pullJobMarketStatus(accountId) {
	if (!jobsCollection || !accountId) return 0;
	const res = await jobsCollection.updateMany(
		{ "status.applier": accountId },
		{ $pull: { status: { applier: accountId } } },
	);
	return res.modifiedCount ?? 0;
}

async function purgeDiskArtifacts(applierName) {
	const draftDir = path.join(SERVER_ROOT, ".local", "agent-resumes", "by-job", safeApplierFs(applierName));
	const chromeDir = path.join(
		REPO_ROOT,
		".data",
		"chrome-sessions",
		`${safeApplierChrome(applierName)}-chrome`,
	);
	const removed = [];
	for (const dir of [draftDir, chromeDir]) {
		try {
			await rm(dir, { recursive: true, force: true });
			removed.push(dir);
		} catch {
			/* ignore */
		}
	}

	// Best-effort: remove Avalon JSONL log files referenced by this applier's runs.
	if (avalonRunsCollection) {
		const runs = await avalonRunsCollection
			.find({ applierName })
			.project({ logFile: 1, runId: 1, startedAt: 1 })
			.limit(5000)
			.toArray();
		for (const run of runs) {
			const logFile = run.logFile ? String(run.logFile) : "";
			if (logFile) {
				try {
					await rm(logFile, { force: true });
				} catch {
					/* ignore */
				}
			}
		}
	}

	return { removedDirs: removed.length };
}

async function purgeFirebaseRecordings(applierName) {
	try {
		const { getFirestoreDb, getStorageBucket } = await import("./firebase/firebaseAdmin.js");
		const bucket = getStorageBucket();
		const slug = slugifyFirebase(applierName);
		const prefixes = [
			`bid-recordings/${slug}/`,
			`user-resumes/${slug}/`,
			`resume-templates/${slug}/`,
			`mail-bodies/${slug}/`,
			`agent-resumes/by-job/${slug}/`,
			`agent-resumes/reviews/${slug}/`,
			`avalon-run-logs/${slug}/`,
		];
		for (const prefix of prefixes) await bucket.deleteFiles({ prefix });

		const chunks = await getFirestoreDb().collection("avalon_run_log_chunks").where("applierName", "==", applierName).get();
		for (let index = 0; index < chunks.docs.length; index += 400) {
			const batch = getFirestoreDb().batch();
			for (const doc of chunks.docs.slice(index, index + 400)) batch.delete(doc.ref);
			await batch.commit();
		}
		return { ok: true, prefixes, avalonLogChunks: chunks.size };
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : String(err) };
	}
}

async function deleteManySafe(collection, filter) {
	if (!collection) return 0;
	const res = await collection.deleteMany(filter);
	return res.deletedCount ?? 0;
}

/**
 * Wipe everything owned by this applier, then delete the account_info row (local + cloud).
 * @param {{ name: string, accountId: import("mongodb").ObjectId }} opts
 */
export async function wipeAccountData({ name, accountId }) {
	const applierName = cleanName(name);
	if (!applierName) throw new Error("name is required");

	const summary = {
		applierName,
		resumes: 0,
		resumeObjects: 0,
		templates: 0,
		templateObjects: 0,
		generations: 0,
		generatorConfig: 0,
		knowledgeGraphs: 0,
		skills: 0,
		matchScores: 0,
		matchProfileState: 0,
		mailMessages: 0,
		mailObjects: 0,
		mailSyncState: 0,
		mailLabels: 0,
		avalonRuns: 0,
		aiUsage: 0,
		vendorTasks: 0,
		bidEvents: 0,
		clearedJobs: 0,
		jobMarketPulled: 0,
		disk: null,
		firebase: null,
		accountDeleted: false,
	};

	const resumes = await purgeUserResumes(applierName);
	summary.resumes = resumes.resumes;
	summary.resumeObjects = resumes.objects;

	const templates = await purgeResumeTemplates(applierName);
	summary.templates = templates.templates;
	summary.templateObjects = templates.objects;

	summary.generations = await deleteManySafe(resumeGenerationsCollection, { applierName });
	summary.generatorConfig = await deleteManySafe(resumeGeneratorConfigCollection, { applierName });
	summary.knowledgeGraphs = await deleteManySafe(userKnowledgeGraphsCollection, { applierName });
	summary.skills = await deleteManySafe(userSkillsCollection, { applierName });

	const scoreWipe = await deleteScoresForApplier(applierName);
	summary.matchScores = scoreWipe.deleted ?? 0;
	summary.matchProfileState = await deleteManySafe(matchProfileStateCollection, { applierName });

	const mail = await purgeMailMessages(applierName);
	summary.mailMessages = mail.messages;
	summary.mailObjects = mail.objects;
	summary.mailSyncState = await deleteManySafe(mailSyncStateCollection, { applierName });
	summary.mailLabels = await deleteManySafe(mailUserLabelsCollection, { applierName });

	summary.avalonRuns = await deleteManySafe(avalonRunsCollection, { applierName });
	summary.aiUsage = await deleteManySafe(aiApiUsageCollection, { applierName });

	const bids = await purgeVendorAndBids(applierName);
	summary.vendorTasks = bids.vendorTasks;
	summary.bidEvents = bids.bidEvents;
	summary.clearedJobs = bids.clearedJobs;

	summary.jobMarketPulled = await pullJobMarketStatus(accountId);

	summary.disk = await purgeDiskArtifacts(applierName);
	summary.firebase = await purgeFirebaseRecordings(applierName);

	invalidateRecommendationCache(applierName);

	// Account row last (includes nested autoBidProfile / resumeCatalog / secrets).
	const accountResult = await deleteAccountInfoByName(applierName);
	summary.accountDeleted = (accountResult.deletedCount ?? 0) > 0;

	return summary;
}

export async function findAccountForDelete(nameRaw) {
	if (!accountInfoCollection) return null;
	const trimmed = cleanName(nameRaw);
	if (!trimmed) return null;
	let acc = await accountInfoCollection.findOne({ name: trimmed });
	if (acc) return acc;
	const esc = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return accountInfoCollection.findOne({
		name: { $regex: new RegExp(`^${esc}$`, "i") },
	});
}
