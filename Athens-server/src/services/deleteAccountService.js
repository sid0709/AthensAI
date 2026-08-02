/**
 * Full account wipe: profile, résumés, agent history, bid data, mail, disk, Firebase, Qdrant.
 * Login identity is account_info.name (applierName).
 */
import { createHash } from "node:crypto";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	accountInfoCollection,
	externalScrapedJobsCollection,
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
	backgroundTasksCollection,
	backgroundTaskInputsCollection,
	getVendorTasksCollection,
	getBidReviewEventsCollection,
} from "../db/dataStore.js";
import { deleteAccountInfoByName } from "./accountInfoStore.js";
import { clearJobBidStatus, listBidQueueJobs } from "./jobBidStatusService.js";
import { deleteScoresForApplier } from "./matching/matchScoreStore.js";
import { removeResumeEmbedding } from "./embeddings/embeddingIngest.js";
import { deleteProfileVector } from "./vectorStore/qdrantClient.js";
import { deleteStoredObject, storageSlug } from "./firebase/objectStore.js";
import { getFirebaseMeta, getFirestoreDb, getStorageBucket } from "./firebase/firebaseAdmin.js";
import { getRedis, isRedisReady } from "../db/redis.js";
import { invalidateMailAccountCache } from "./mail/credentials.js";
import { invalidateMailListCaches } from "./mail/mailSyncService.js";
import { evictAccountPool } from "./mail/imapPool.js";
import { invalidateLiveProjectedStatusCount } from "./jobStatusProjectionService.js";
import { unregisterJobListProfile } from "./jobListReadModelService.js";
import { backgroundTaskKeys } from "./backgroundTasks/redisKeys.js";
import {
	acknowledgeBackgroundTaskCancellation,
	flushBackgroundTaskMirrors,
	getBackgroundTask,
	requestBackgroundTaskCancellation,
} from "./backgroundTasks/taskStore.js";
import { TERMINAL_TASK_STATUSES } from "./backgroundTasks/taskTypes.js";

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

async function purgeUserResumes(ownerName) {
	if (!userResumesCollection) return { resumes: 0, objects: 0 };
	const docs = await userResumesCollection.find({ ownerName }).toArray();
	let objects = 0;
	for (const doc of docs) {
		if (await deleteStoredObject(doc)) objects += 1;
		await removeResumeEmbedding(String(doc._id)).catch(() => {});
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
		if (await deleteStoredObject(doc)) objects += 1;
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

async function purgeMailConnections(ownerName) {
	if (!accountInfoCollection) return 0;
	const account = await accountInfoCollection.findOne(
		{ name: ownerName },
		{ projection: { "autoBidProfile.email": 1 } },
	);
	return evictAccountPool(account?.autoBidProfile?.email);
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
	const collections = [jobsCollection, externalScrapedJobsCollection].filter(Boolean);
	const results = await Promise.all(collections.map((collection) => collection.updateMany(
		{ "status.applier": accountId },
		{ $pull: { status: { applier: accountId } } },
	)));
	return results.reduce((total, result) => total + Number(result.modifiedCount || 0), 0);
}

async function purgeLocalReviewCopies(applierName) {
	const root = path.join(SERVER_ROOT, ".local", "agent-resumes");
	const prefix = `${safeApplierFs(applierName)}-`;
	let removedFiles = 0;
	let entries = [];
	try {
		entries = await readdir(root, { withFileTypes: true });
	} catch {
		return removedFiles;
	}
	for (const entry of entries) {
		if (!entry.isDirectory() || entry.name === "by-job") continue;
		const directory = path.join(root, entry.name);
		let files = [];
		try {
			files = await readdir(directory, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const file of files) {
			if (!file.isFile() || !file.name.startsWith(prefix)) continue;
			await rm(path.join(directory, file.name), { force: true });
			removedFiles += 1;
		}
	}
	return removedFiles;
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
	const removedReviewFiles = await purgeLocalReviewCopies(applierName);

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

	return { removedDirs: removed.length, removedReviewFiles };
}

async function deleteFirestoreQuery(query) {
	const snapshot = await query.get();
	for (let index = 0; index < snapshot.docs.length; index += 400) {
		const batch = getFirestoreDb().batch();
		for (const doc of snapshot.docs.slice(index, index + 400)) batch.delete(doc.ref);
		await batch.commit();
	}
	return snapshot.size;
}

async function purgeFirebaseData(applierName, profileId, uid) {
	const db = getFirestoreDb();
	const slug = storageSlug(applierName);
	let prefixes = [];
	if (getFirebaseMeta().storageBucket) {
		const bucket = getStorageBucket();
		prefixes = [
			`bid-recordings/${slug}/`,
			`user-resumes/${slug}/`,
			`resume-templates/${slug}/`,
			`mail-bodies/${slug}/`,
			`agent-resumes/by-job/${slug}/`,
			`agent-resumes/reviews/${slug}/`,
			`avalon-run-logs/${slug}/`,
		];
		for (const prefix of prefixes) await bucket.deleteFiles({ prefix });
	}
	const [avalonLogChunks, uploadSessions, jobStatuses, statusOutbox, profileAccess] = await Promise.all([
		deleteFirestoreQuery(db.collection("avalon_run_log_chunks").where("applierName", "==", applierName)),
		deleteFirestoreQuery(db.collection("upload_sessions").where("applierName", "==", applierName)),
		profileId ? deleteFirestoreQuery(db.collection("job_statuses").where("profileId", "==", profileId)) : 0,
		profileId ? deleteFirestoreQuery(db.collection("job_status_outbox").where("profileId", "==", profileId)) : 0,
		profileId ? deleteFirestoreQuery(db.collection("profile_access").where("profileId", "==", profileId)) : 0,
	]);
	return {
		ok: true,
		prefixes,
		avalonLogChunks,
		uploadSessions,
		jobStatuses,
		statusOutbox,
		profileAccess,
		uid: uid || null,
	};
}

function redisGlobEscape(value) {
	return String(value).replace(/[\\*?\[\]]/g, "\\$&");
}

async function scanRedisKeys(redis, pattern) {
	const keys = new Set();
	for await (const result of redis.scanIterator({ MATCH: pattern, COUNT: 500 })) {
		for (const key of Array.isArray(result) ? result : [result]) if (key) keys.add(String(key));
	}
	return [...keys];
}

async function purgeProfileCaches(applierName, profileId) {
	await Promise.all([
		invalidateMailAccountCache(applierName),
		invalidateMailListCaches(applierName),
		unregisterJobListProfile({ profileId, applierName }),
	]);
	invalidateLiveProjectedStatusCount(profileId);
	if (!isRedisReady()) return { deleted: 0 };

	const redis = getRedis();
	const lowerName = applierName.toLowerCase();
	const ranking16 = createHash("sha256").update(applierName).digest("hex").slice(0, 16);
	const ranking20 = createHash("sha256").update(applierName).digest("hex").slice(0, 20);
	const encodedProfileId = encodeURIComponent(profileId);
	const taskIds = profileId
		? await redis.zRange(backgroundTaskKeys.profileTasks(profileId), 0, -1).catch(() => [])
		: [];
	const exact = [
		`mail:v2:account:${lowerName}`,
		`mail:v2:label-definitions:${lowerName}`,
		`mail:v2:unlabeled-revision:${lowerName}`,
		`profile:skills:${applierName}`,
		`profile:match:${applierName}`,
		`profile:skill-docs:${applierName}`,
		`profile:skills-revision:${applierName}`,
		`ranking:v2:profile-version:${ranking20}`,
		...(profileId ? [`ranking:v2:status-revision:${profileId}`] : []),
		...taskIds.flatMap((taskId) => [backgroundTaskKeys.task(taskId), backgroundTaskKeys.cancel(taskId)]),
	];
	const patterns = [
		`mail:v9:unlabeled-page:${redisGlobEscape(lowerName)}:*`,
		`mail:v9:unlabeled-catalog:${redisGlobEscape(lowerName)}:*`,
		`ranking:v2:${ranking16}:*`,
		`jobs:list:v2:ranking:${ranking20}:*`,
		...(profileId ? [
			`ranking:v5:job-status*:firestore:${redisGlobEscape(profileId)}:*`,
			`athens:background:v1:request:${redisGlobEscape(encodedProfileId)}:*`,
			`athens:background:v1:active:${redisGlobEscape(encodedProfileId)}:*`,
			`athens:background:v1:profile:${redisGlobEscape(encodedProfileId)}:*`,
		] : []),
	];
	const matched = new Set(exact);
	for (const pattern of patterns) {
		for (const key of await scanRedisKeys(redis, pattern)) matched.add(key);
	}
	const keys = [...matched];
	let deleted = 0;
	for (let index = 0; index < keys.length; index += 500) {
		deleted += Number(await redis.del(keys.slice(index, index + 500))) || 0;
	}
	return { deleted };
}

async function quiesceBackgroundTasks(profileId) {
	if (!profileId || !isRedisReady()) return { taskIds: [], cancelled: 0 };
	const redis = getRedis();
	const taskIds = await redis.zRange(backgroundTaskKeys.profileTasks(profileId), 0, -1).catch(() => []);
	let cancelled = 0;
	for (const taskId of taskIds) {
		const current = await getBackgroundTask(taskId);
		if (!current || TERMINAL_TASK_STATUSES.has(current.status)) continue;
		await requestBackgroundTaskCancellation(taskId);
		if (current.status === "queued") await acknowledgeBackgroundTaskCancellation(taskId);
		cancelled += 1;
	}

	const deadline = Date.now() + 15_000;
	let active = [];
	do {
		active = (await Promise.all(taskIds.map((taskId) => getBackgroundTask(taskId))))
			.filter((task) => task && !TERMINAL_TASK_STATUSES.has(task.status));
		if (!active.length) break;
		await new Promise((resolve) => setTimeout(resolve, 100));
	} while (Date.now() < deadline);
	if (active.length) {
		const error = new Error("Background work is still stopping. Try deleting the account again in a moment.");
		error.status = 409;
		error.code = "ACCOUNT_BACKGROUND_TASKS_ACTIVE";
		throw error;
	}
	await flushBackgroundTaskMirrors(taskIds);
	return { taskIds, cancelled };
}

async function deleteManySafe(collection, filter) {
	if (!collection) return 0;
	const res = await collection.deleteMany(filter);
	return res.deletedCount ?? 0;
}

/**
 * Wipe everything owned by this applier, then delete the account record.
 * @param {{ name: string, accountId: import("@nextoffer/shared/document-id").DocumentId, uid?: string | null }} opts
 */
export async function wipeAccountData({ name, accountId, uid = null }) {
	const applierName = cleanName(name);
	if (!applierName) throw new Error("name is required");
	const profileId = String(accountId || "");
	const background = await quiesceBackgroundTasks(profileId);

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
		mailConnections: 0,
		avalonRuns: 0,
		aiUsage: 0,
		backgroundTasks: 0,
		backgroundTaskInputs: 0,
		backgroundTasksCancelled: background.cancelled,
		vendorTasks: 0,
		bidEvents: 0,
		clearedJobs: 0,
		jobMarketPulled: 0,
		disk: null,
		firebase: null,
		caches: null,
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
	summary.mailConnections = await purgeMailConnections(applierName);

	summary.avalonRuns = await deleteManySafe(avalonRunsCollection, { applierName });
	summary.aiUsage = await deleteManySafe(aiApiUsageCollection, { applierName });
	summary.backgroundTasks = await deleteManySafe(backgroundTasksCollection, { applierName });
	summary.backgroundTaskInputs = await deleteManySafe(backgroundTaskInputsCollection, { applierName });

	const bids = await purgeVendorAndBids(applierName);
	summary.vendorTasks = bids.vendorTasks;
	summary.bidEvents = bids.bidEvents;
	summary.clearedJobs = bids.clearedJobs;

	summary.jobMarketPulled = await pullJobMarketStatus(accountId);

	summary.disk = await purgeDiskArtifacts(applierName);
	summary.caches = await purgeProfileCaches(applierName, profileId);
	summary.firebase = await purgeFirebaseData(applierName, profileId, uid);

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
