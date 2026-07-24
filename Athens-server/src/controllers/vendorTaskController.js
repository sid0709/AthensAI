import { ObjectId } from "mongodb";
import {
	getVendorTasksCollection,
	jobsCollection,
} from "../db/mongo.js";
import { detectJobSource } from "../lib/jobSource.js";
import {
	clearJobBidStatus,
	listBidQueueJobs,
	normalizeApplyUrlKey,
	resolveApplierId,
	upsertJobBidStatus,
} from "../services/jobBidStatusService.js";

const TASK_STATUSES = new Set(["pending", "done", "skipped"]);

function normalizeUrlKey(url) {
	return normalizeApplyUrlKey(url);
}

function toObjectId(value) {
	if (!value) return null;
	if (value instanceof ObjectId) return value;
	try {
		return new ObjectId(String(value));
	} catch {
		return null;
	}
}

export function serializeTask(doc) {
	const applyUrl = doc.applyUrl ?? null;
	const jobSource = detectJobSource(applyUrl);
	let progress = "idle";
	if (doc.status === "done" || doc.recordingPath) progress = "completed";
	else if (doc.status === "skipped") progress = "skipped";
	else if (doc.bidderInProcess) progress = "active";

	const recording = doc.recordingPath
		? {
				storagePath: String(doc.recordingPath),
				contentType: doc.recordingContentType || "video/webm",
				sizeBytes: Number(doc.recordingSize || 0),
				sessionId: doc.bidSessionId || null,
			}
		: null;

	const companyRaw = doc.company;
	const company =
		typeof companyRaw === "string"
			? companyRaw
			: companyRaw && typeof companyRaw === "object" && typeof companyRaw.name === "string"
				? companyRaw.name
				: "";

	return {
		id: String(doc._id),
		applierName: doc.applierName ?? null,
		jobId: doc.jobId ?? null,
		title: doc.title ?? "Untitled role",
		company,
		applyUrl,
		source: doc.source ?? jobSource?.label ?? "",
		location: doc.location ?? "",
		workMode: doc.workMode ?? "",
		matchScore: typeof doc.matchScore === "number" ? doc.matchScore : null,
		status: TASK_STATUSES.has(doc.status) ? doc.status : "pending",
		progress,
		jobSource,
		addedAt: doc.addedAt instanceof Date ? doc.addedAt.toISOString() : doc.addedAt ?? null,
		updatedAt: doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : doc.updatedAt ?? null,
		completedAt:
			doc.completedAt instanceof Date
				? doc.completedAt.toISOString()
				: doc.completedAt ?? null,
		bidReadyDate:
			doc.bidReadyDate instanceof Date
				? doc.bidReadyDate.toISOString()
				: doc.bidReadyDate ?? null,
		recording,
		reviewStatus: doc.reviewStatus || null,
		bidderName: doc.bidderName || null,
		bidderInProcess: Boolean(doc.bidderInProcess),
		bidderInProcessAt:
			doc.bidderInProcessAt instanceof Date
				? doc.bidderInProcessAt.toISOString()
				: doc.bidderInProcessAt ?? null,
		recordingDurationSec:
			typeof doc.recordingDurationSec === "number" ? doc.recordingDurationSec : null,
		recordingStartedAt:
			doc.recordingStartedAt instanceof Date
				? doc.recordingStartedAt.toISOString()
				: doc.recordingStartedAt ?? null,
		recordingEndedAt:
			doc.recordingEndedAt instanceof Date
				? doc.recordingEndedAt.toISOString()
				: doc.recordingEndedAt ?? null,
		biddingDurationSec:
			typeof doc.biddingDurationSec === "number" ? doc.biddingDurationSec : null,
		flags: doc.flags && typeof doc.flags === "object" ? doc.flags : null,
		analysisSummary:
			typeof doc.analysisSummary === "string" ? doc.analysisSummary : null,
		rejectReason: typeof doc.rejectReason === "string" ? doc.rejectReason : null,
		rejectSource:
			doc.rejectSource === "submitted" || doc.rejectSource === "skipped"
				? doc.rejectSource
				: null,
		rejectCount: Number(doc.rejectCount || 0) || 0,
		resubmitCount: Number(doc.resubmitCount || 0) || 0,
		lastRejectedAt:
			doc.lastRejectedAt instanceof Date
				? doc.lastRejectedAt.toISOString()
				: doc.lastRejectedAt ?? null,
		lastResubmittedAt:
			doc.lastResubmittedAt instanceof Date
				? doc.lastResubmittedAt.toISOString()
				: doc.lastResubmittedAt ?? null,
		resumeOriginalName:
			typeof doc.resumeOriginalName === "string" ? doc.resumeOriginalName : null,
		resumeExpectedName:
			typeof doc.resumeExpectedName === "string" ? doc.resumeExpectedName : null,
		resumeCleanedName:
			typeof doc.resumeCleanedName === "string" ? doc.resumeCleanedName : null,
		resumeRenamed: Boolean(doc.resumeRenamed),
		resumeMismatch: Boolean(doc.resumeMismatch),
		recommendedResumeStack:
			typeof doc.recommendedResumeStack === "string" ? doc.recommendedResumeStack : null,
		recommendedResumeReason:
			typeof doc.recommendedResumeReason === "string" ? doc.recommendedResumeReason : null,
		useCustomizedResume: Boolean(doc.useCustomizedResume),
		recommendWarning:
			typeof doc.recommendWarning === "string" ? doc.recommendWarning : null,
		recommendedAt:
			doc.recommendedAt instanceof Date
				? doc.recommendedAt.toISOString()
				: doc.recommendedAt ?? null,
		resumeStackMatch:
			doc.resumeStackMatch === "match" ||
			doc.resumeStackMatch === "mismatch" ||
			doc.resumeStackMatch === "unknown"
				? doc.resumeStackMatch
				: null,
	};
}

function resolveVendorTasks() {
	const collection = getVendorTasksCollection();
	if (!collection) {
		return { collection: null, error: "Database is not connected." };
	}
	return { collection, error: null };
}

/**
 * GET /vendor/tasks?applierName=
 * Returns all Bid ready (+ bid-completed) jobs for the applier from job_market,
 * merged with vendor_tasks metadata (Bid-Monitor progress).
 */
export async function listVendorTasks(req, res) {
	try {
		const applierName = String(req.query.applierName ?? "").trim();
		if (!applierName) {
			return res.status(400).json({ success: false, error: "applierName is required." });
		}

		const { collection, error } = resolveVendorTasks();
		if (error || !collection) {
			return res.status(503).json({ success: false, error: error || "Unavailable." });
		}

		const [queueJobs, taskDocs] = await Promise.all([
			listBidQueueJobs(applierName, { limit: 1000, includeCompleted: true }),
			collection.find({ applierName }).sort({ addedAt: -1 }).limit(1000).toArray(),
		]);

		const taskByJobId = new Map();
		for (const doc of taskDocs) {
			if (doc.jobId) taskByJobId.set(String(doc.jobId), doc);
		}

		const tasks = queueJobs.map((job) => {
			const doc = taskByJobId.get(job.jobId);
			// Prefer bidReadyDate for folder day grouping in Bid Management.
			const bidReadyAt = job.bidReadyDate || null;
			const base = doc
				? {
						...serializeTask(doc),
						addedAt:
							bidReadyAt instanceof Date
								? bidReadyAt.toISOString()
								: bidReadyAt ||
									(doc.addedAt instanceof Date ? doc.addedAt.toISOString() : doc.addedAt ?? null),
						bidReadyDate:
							bidReadyAt instanceof Date
								? bidReadyAt.toISOString()
								: bidReadyAt ||
									(doc.addedAt instanceof Date ? doc.addedAt.toISOString() : doc.addedAt ?? null),
					}
				: {
						...serializeTask({
							_id: job.jobId,
							applierName,
							jobId: job.jobId,
							title: job.title,
							company: job.company,
							applyUrl: job.applyUrl,
							source: job.source,
							location: "",
							workMode: "",
							matchScore: null,
							status: job.completed ? "done" : "pending",
							addedAt: bidReadyAt,
							updatedAt: job.bidCompletedDate || bidReadyAt,
							completedAt: job.bidCompletedDate,
						}),
						bidReadyDate:
							bidReadyAt instanceof Date ? bidReadyAt.toISOString() : bidReadyAt,
					};

			if (job.completed && base.progress !== "completed") {
				return { ...base, status: "done", progress: "completed" };
			}
			return base;
		});

		await Promise.all(
			tasks
				.filter((t) => t.progress === "completed" && t.jobId)
				.map((t) => upsertJobBidStatus(applierName, t.jobId, { bidCompleted: true })),
		);

		const totals = {
			total: tasks.length,
			pending: tasks.filter((t) => t.status === "pending" && t.progress === "idle").length,
			active: tasks.filter((t) => t.progress === "active").length,
			done: tasks.filter((t) => t.progress === "completed" || t.status === "done").length,
			skipped: tasks.filter((t) => t.status === "skipped").length,
		};

		return res.json({ success: true, tasks, totals });
	} catch (err) {
		console.error("[vendor/tasks] list failed", err);
		return res.status(500).json({ success: false, error: err.message || "Failed to list tasks." });
	}
}

/**
 * POST /vendor/tasks
 * body: { applierName, jobs: [{ jobId, title, company, applyUrl, source, location, workMode, matchScore }] }
 */
export async function addVendorTasks(req, res) {
	try {
		const applierName = String(req.body?.applierName ?? "").trim();
		const jobs = Array.isArray(req.body?.jobs) ? req.body.jobs : [];
		if (!applierName) {
			return res.status(400).json({ success: false, error: "applierName is required." });
		}
		if (!jobs.length) {
			return res.status(400).json({ success: false, error: "jobs array is required." });
		}

		const { collection, error } = resolveVendorTasks();
		if (error || !collection) {
			return res.status(503).json({ success: false, error: error || "Unavailable." });
		}

		const now = new Date();
		const toInsert = [];
		const skipped = [];

		for (const raw of jobs) {
			const jobId = String(raw?.jobId ?? raw?.id ?? "").trim();
			const applyUrl = String(raw?.applyUrl ?? "").trim();
			if (!jobId && !applyUrl) {
				skipped.push({ reason: "missing jobId/applyUrl", job: raw });
				continue;
			}

			const existingQuery = jobId
				? { applierName, jobId }
				: { applierName, applyUrl };
			const existing = await collection.findOne(existingQuery, { projection: { _id: 1 } });
			if (existing) {
				skipped.push({ reason: "already_in_pool", jobId, applyUrl });
				continue;
			}

			toInsert.push({
				applierName,
				jobId: jobId || null,
				title: String(raw?.title ?? "Untitled role").trim() || "Untitled role",
				company: String(raw?.company ?? "").trim(),
				applyUrl: applyUrl || null,
				source: String(raw?.source ?? "").trim(),
				location: String(raw?.location ?? "").trim(),
				workMode: String(raw?.workMode ?? "").trim(),
				matchScore: typeof raw?.matchScore === "number" ? raw.matchScore : null,
				status: "pending",
				addedAt: now,
				updatedAt: now,
				completedAt: null,
			});
		}

		let inserted = [];
		if (toInsert.length) {
			try {
				const result = await collection.insertMany(toInsert, { ordered: false });
				const ids = Object.values(result.insertedIds);
				inserted = await collection.find({ _id: { $in: ids } }).toArray();
			} catch (err) {
				// ordered:false — some docs may still insert on duplicate-key races
				if (err?.insertedIds) {
					const ids = Object.values(err.insertedIds);
					if (ids.length) {
						inserted = await collection.find({ _id: { $in: ids } }).toArray();
					}
				} else if (err?.result?.insertedIds) {
					const ids = Object.values(err.result.insertedIds);
					if (ids.length) {
						inserted = await collection.find({ _id: { $in: ids } }).toArray();
					}
				} else {
					throw err;
				}
				const dupCount = toInsert.length - inserted.length;
				if (dupCount > 0) {
					skipped.push(
						...Array.from({ length: dupCount }, () => ({ reason: "already_in_pool" })),
					);
				}
			}
		}

		await Promise.all(
			inserted
				.filter((d) => d.jobId)
				.map((d) => upsertJobBidStatus(applierName, d.jobId, { bidReady: true })),
		);

		return res.json({
			success: true,
			added: inserted.map((d) => serializeTask(d)),
			addedCount: inserted.length,
			skippedCount: skipped.length,
			skipped,
		});
	} catch (err) {
		console.error("[vendor/tasks] add failed", err);
		return res.status(500).json({ success: false, error: err.message || "Failed to add tasks." });
	}
}

/**
 * PATCH /vendor/tasks/:taskId
 * body: { status: 'pending' | 'done' | 'skipped', applierName? }
 * taskId may be a vendor_tasks _id or a jobId for bid-ready-only rows.
 */
export async function updateVendorTask(req, res) {
	try {
		const taskId = String(req.params.taskId ?? "").trim();
		const status = String(req.body?.status ?? "").trim();
		const applierName = String(req.body?.applierName ?? req.query?.applierName ?? "").trim();
		if (!TASK_STATUSES.has(status)) {
			return res.status(400).json({ success: false, error: "status must be pending, done, or skipped." });
		}

		const { collection, error } = resolveVendorTasks();
		if (error || !collection) {
			return res.status(503).json({ success: false, error: error || "Unavailable." });
		}

		const now = new Date();
		const update = {
			status,
			updatedAt: now,
			completedAt: status === "done" ? now : null,
		};

		let doc = null;
		if (ObjectId.isValid(taskId)) {
			const result = await collection.findOneAndUpdate(
				{ _id: new ObjectId(taskId), applierName },
				{ $set: update },
				{ returnDocument: "after" },
			);
			doc = result?.value ?? result;
			if (doc && !doc._id) doc = null;
		}
		if (!doc) {
			const query = { applierName, jobId: taskId };
			const result = await collection.findOneAndUpdate(query, { $set: update }, { returnDocument: "after" });
			doc = result?.value ?? result;
			if (doc && !doc._id) doc = null;
		}

		const jobId = doc?.jobId ? String(doc.jobId) : taskId;
		const owner = doc?.applierName ? String(doc.applierName) : applierName;

		if (status === "done" && jobId && owner) {
			await upsertJobBidStatus(owner, jobId, { bidCompleted: true });
		}

		if (!doc) {
			if (!owner || !jobId) {
				return res.status(404).json({ success: false, error: "Task not found." });
			}
			return res.json({
				success: true,
				task: serializeTask({
					_id: jobId,
					applierName: owner,
					jobId,
					title: "Untitled role",
					status,
					completedAt: status === "done" ? now : null,
					updatedAt: now,
					addedAt: now,
				}),
			});
		}

		return res.json({ success: true, task: serializeTask(doc) });
	} catch (err) {
		console.error("[vendor/tasks] update failed", err);
		return res.status(500).json({ success: false, error: err.message || "Failed to update task." });
	}
}

/**
 * DELETE /vendor/tasks/:taskId
 * Clears Bid ready on the linked job so it returns to New in Job Search.
 */
export async function deleteVendorTask(req, res) {
	try {
		const taskId = String(req.params.taskId ?? "").trim();
		const { collection, error } = resolveVendorTasks();
		if (error || !collection) {
			return res.status(503).json({ success: false, error: error || "Unavailable." });
		}

		let doc = null;
		if (ObjectId.isValid(taskId)) {
			doc = await collection.findOne({ _id: new ObjectId(taskId) });
		}
		if (!doc) {
			doc = await collection.findOne({ jobId: taskId });
		}

		const jobId = doc?.jobId ? String(doc.jobId) : ObjectId.isValid(taskId) ? null : taskId;
		const applierName = doc?.applierName ? String(doc.applierName) : String(req.query.applierName ?? "").trim();

		if (doc?._id) {
			await collection.deleteOne({ _id: doc._id });
		} else if (jobId && applierName) {
			await collection.deleteMany({ applierName, jobId });
		} else if (!jobId) {
			return res.status(404).json({ success: false, error: "Task not found." });
		}

		if (jobId && applierName) {
			await clearJobBidStatus(applierName, jobId);
		}

		return res.json({ success: true, deleted: 1, jobId });
	} catch (err) {
		console.error("[vendor/tasks] delete failed", err);
		return res.status(500).json({ success: false, error: err.message || "Failed to delete task." });
	}
}

/**
 * DELETE /vendor/tasks?applierName=
 */
export async function clearVendorTasks(req, res) {
	try {
		const applierName = String(req.query.applierName ?? "").trim();
		if (!applierName) {
			return res.status(400).json({ success: false, error: "applierName is required." });
		}

		const { collection, error } = resolveVendorTasks();
		if (error || !collection) {
			return res.status(503).json({ success: false, error: error || "Unavailable." });
		}

		const docs = await collection.find({ applierName }).project({ jobId: 1 }).toArray();
		const jobIds = [...new Set(docs.map((d) => d.jobId).filter(Boolean).map(String))];

		// Also clear every bid-ready job for this applier (source of truth).
		const queueJobs = await listBidQueueJobs(applierName, { limit: 1000, includeCompleted: true });
		for (const job of queueJobs) jobIds.push(job.jobId);
		const uniqueJobIds = [...new Set(jobIds)];

		const result = await collection.deleteMany({ applierName });
		await Promise.all(uniqueJobIds.map((jobId) => clearJobBidStatus(applierName, jobId)));

		return res.json({ success: true, deleted: result.deletedCount ?? 0, clearedJobs: uniqueJobIds.length });
	} catch (err) {
		console.error("[vendor/tasks] clear failed", err);
		return res.status(500).json({ success: false, error: err.message || "Failed to clear tasks." });
	}
}

/**
 * GET /vendor/tasks/analytics?applierName=&since=&until=
 */
export async function getVendorTasksAnalytics(req, res) {
	try {
		const applierName = String(req.query.applierName ?? "").trim();
		if (!applierName) {
			return res.status(400).json({ success: false, error: "applierName is required." });
		}

		const { collection, error } = resolveVendorTasks();
		if (error || !collection) {
			return res.status(503).json({ success: false, error: error || "Unavailable." });
		}

		const sinceRaw = String(req.query.since ?? req.query.from ?? "").trim();
		const untilRaw = String(req.query.until ?? req.query.to ?? "").trim();
		const since = sinceRaw ? new Date(sinceRaw) : null;
		const until = untilRaw ? new Date(untilRaw) : null;
		const sinceOk = since && !Number.isNaN(since.getTime()) ? since : null;
		const untilOk = until && !Number.isNaN(until.getTime()) ? until : null;

		const match = { applierName };
		if (sinceOk || untilOk) {
			match.addedAt = {};
			if (sinceOk) match.addedAt.$gte = sinceOk;
			if (untilOk) match.addedAt.$lte = untilOk;
		}

		const docs = await collection.find(match).sort({ addedAt: 1 }).limit(5000).toArray();
		const tasks = docs.map((doc) => serializeTask(doc));

		const bySourceMap = new Map();
		const byDayMap = new Map();
		for (const task of tasks) {
			const sourceKey = task.source || task.jobSource?.label || "Unknown";
			const sourceRow = bySourceMap.get(sourceKey) || {
				label: sourceKey,
				host: task.jobSource?.host ?? null,
				total: 0,
				done: 0,
				active: 0,
				pending: 0,
				skipped: 0,
			};
			sourceRow.total += 1;
			if (task.progress === "completed" || task.status === "done") sourceRow.done += 1;
			else if (task.progress === "active") sourceRow.active += 1;
			else if (task.status === "skipped") sourceRow.skipped += 1;
			else sourceRow.pending += 1;
			bySourceMap.set(sourceKey, sourceRow);

			const day = (task.addedAt || "").slice(0, 10);
			if (day) {
				const dayRow = byDayMap.get(day) || { day, added: 0, done: 0 };
				dayRow.added += 1;
				if (task.progress === "completed" || task.status === "done") dayRow.done += 1;
				byDayMap.set(day, dayRow);
			}
		}

		const done = tasks.filter((t) => t.progress === "completed" || t.status === "done").length;
		const active = tasks.filter((t) => t.progress === "active").length;
		const skipped = tasks.filter((t) => t.status === "skipped").length;
		const pending = tasks.length - done - active - skipped;
		const completionRate = tasks.length ? done / tasks.length : 0;

		// How many pool jobs are still "posted" (not applied) in job_market.
		let stillPosted = null;
		if (jobsCollection && tasks.some((t) => t.jobId)) {
			const ids = tasks
				.map((t) => t.jobId)
				.filter((id) => ObjectId.isValid(id))
				.map((id) => new ObjectId(id));
			if (ids.length) {
				const account = accountInfoCollection
					? await accountInfoCollection.findOne(
							{ name: applierName },
							{ projection: { _id: 1 } },
						)
					: null;
				const applierId = account?._id ? String(account._id) : null;
				const marketJobs = await jobsCollection
					.find({ _id: { $in: ids } }, { projection: { status: 1 } })
					.toArray();
				stillPosted = 0;
				for (const job of marketJobs) {
					const statusArr = Array.isArray(job.status) ? job.status : [];
					const applied = applierId
						? statusArr.some(
								(s) =>
									s &&
									String(s.applier) === applierId &&
									(s.appliedDate || s.scheduledDate || s.declinedDate),
							)
						: false;
					if (!applied) stillPosted += 1;
				}
			}
		}

		return res.json({
			success: true,
			since: sinceOk?.toISOString() ?? null,
			until: untilOk?.toISOString() ?? null,
			totals: {
				total: tasks.length,
				pending: Math.max(0, pending),
				active,
				done,
				skipped,
				completionRate,
				stillPosted,
			},
			byDay: [...byDayMap.values()].sort((a, b) => a.day.localeCompare(b.day)),
			bySource: [...bySourceMap.values()].sort((a, b) => b.total - a.total),
		});
	} catch (err) {
		console.error("[vendor/tasks/analytics] failed", err);
		return res
			.status(500)
			.json({ success: false, error: err.message || "Failed to load task analytics." });
	}
}
