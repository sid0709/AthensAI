import { ObjectId } from "mongodb";
import {
	getVendorTasksCollection,
	jobsCollection,
	llmCallLogCollection,
} from "../db/mongo.js";
import { detectJobSource } from "../lib/jobSource.js";
import { deriveBidUiStatus, REVIEW_STATUSES } from "../lib/bidResultStatus.js";
import {
	buildCanonicalResumeFileName,
	isResumeNameMismatch,
	profileNameToFileBase,
	resumeBasename,
} from "../lib/canonicalResumeName.js";
import { matchUploadToRecommended } from "../lib/resumeCatalogCompress.js";
import {
	getJobBidReadyDate,
	listBidQueueJobs,
	upsertJobBidStatus,
} from "../services/jobBidStatusService.js";
import { uploadBidRecordingObject } from "../services/firebase/bidRecordingUpload.js";
import {
	appendBidReviewEvent,
	listBidReviewEvents,
} from "../services/bidReviewEventsService.js";
import { serializeTask } from "./vendorTaskController.js";

function toObjectId(value) {
	if (!value) return null;
	if (value instanceof ObjectId) return value;
	try {
		return new ObjectId(String(value));
	} catch {
		return null;
	}
}

function initials(name) {
	const parts = String(name || "?").trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) return "?";
	if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
	return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

/** job_market.company may be a string or { name, tags, logo }. */
function companyDisplayName(company) {
	if (typeof company === "string") return company.trim() || "Unknown";
	if (company && typeof company === "object") {
		const name = company.name ?? company.companyName;
		if (typeof name === "string" && name.trim()) return name.trim();
	}
	return "Unknown";
}

function pad2(n) {
	return String(n).padStart(2, "0");
}

function dayKeyFromIsoFixed(iso) {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) {
		const now = new Date();
		return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
	}
	return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Prefer job-queue bidReadyDate (stable folder day) over vendor-task addedAt
 * which may be completion / upsert time.
 */
async function withStableBidReadyDate(task, applierName) {
	if (!task) return task;
	const jobId = task.jobId ? String(task.jobId) : "";
	const name = String(applierName || task.applierName || "").trim();
	if (!jobId || !name) return task;
	try {
		const bidReadyDate = await getJobBidReadyDate(name, jobId);
		if (!bidReadyDate) return task;
		return { ...task, bidReadyDate, addedAt: task.addedAt || bidReadyDate };
	} catch {
		return task;
	}
}

function mapTaskToBidResult(task) {
	const pooledAt = task.bidReadyDate || task.addedAt || new Date().toISOString();
	const bidderName = task.bidderName || task.applierName || "Unassigned";
	const status = deriveBidUiStatus(task);

	const recording = task.recording?.storagePath
		? {
				storagePath: task.recording.storagePath,
				contentType: task.recording.contentType || "video/webm",
				sizeBytes: Number(task.recording.sizeBytes || 0),
				previewUrl: null,
			}
		: null;

	const rejectReason =
		typeof task.rejectReason === "string" && task.rejectReason.trim()
			? task.rejectReason.trim()
			: null;
	const rejectSource =
		task.rejectSource === "submitted" || task.rejectSource === "skipped"
			? task.rejectSource
			: null;

	return {
		id: `bid-${task.id}`,
		taskId: task.id,
		jobId: task.jobId || null,
		dayKey: dayKeyFromIsoFixed(pooledAt),
		job: {
			title: task.title || "Untitled role",
			company: companyDisplayName(task.company),
			location: task.location || "—",
			source: task.source || "—",
			applyUrl: task.applyUrl || "#",
		},
		bidder: {
			name: bidderName,
			avatarInitials: initials(bidderName),
		},
		status,
		pooledAt,
		submittedAt:
			task.completedAt ||
			(status !== "pending" && status !== "in_process" ? task.updatedAt : null),
		durationSec:
			typeof task.recordingDurationSec === "number" ? task.recordingDurationSec : null,
		biddingDurationSec:
			typeof task.biddingDurationSec === "number" ? task.biddingDurationSec : null,
		matchScore: task.matchScore,
		flags: {
			remote:
				task.flags?.remote?.status === "green" || task.flags?.remote?.status === "red"
					? task.flags.remote.status
					: task.flags?.remote === "green" || task.flags?.remote === "red"
						? task.flags.remote
						: null,
			clearance:
				task.flags?.clearance?.status === "green" ||
				task.flags?.clearance?.status === "red"
					? task.flags.clearance.status
					: task.flags?.clearance === "green" || task.flags?.clearance === "red"
						? task.flags.clearance
						: null,
		},
		analysisSummary: task.analysisSummary || null,
		jobDetail: null,
		recommendedResume: task.recommendedResumeStack
			? {
					name: task.useCustomizedResume
						? "Use customized resume"
						: `Recommended · ${task.recommendedResumeStack}`,
					techStack: task.recommendedResumeStack,
					source: "Library recommend",
					fileName: null,
					usedAt: task.recommendedAt || null,
					scorePercent: null,
				}
			: task.useCustomizedResume
				? {
						name: "Use customized resume",
						techStack: null,
						source: "Library recommend",
						fileName: null,
						usedAt: task.recommendedAt || null,
						scorePercent: null,
					}
				: null,
		submissionResume: null,
		recommendedResumeStack: task.recommendedResumeStack || null,
		recommendedResumeReason: task.recommendedResumeReason || null,
		useCustomizedResume: Boolean(task.useCustomizedResume),
		recommendWarning: task.recommendWarning || null,
		recommendedAt: task.recommendedAt || null,
		resumeStackMatch:
			task.resumeStackMatch === "match" ||
			task.resumeStackMatch === "mismatch" ||
			task.resumeStackMatch === "unknown"
				? task.resumeStackMatch
				: null,
		recording,
		notes:
			status === "pending"
				? "Bid ready — waiting for bidder"
				: status === "in_process"
					? "Bid in progress"
					: status === "skipped"
						? "Skipped by bidder"
						: status === "rejected" && rejectReason
							? rejectReason
							: recording
								? "Recording uploaded"
								: null,
		sessionId: task.recording?.sessionId || null,
		rejectReason,
		rejectSource,
		rejectCount: Number(task.rejectCount || 0) || 0,
		resubmitCount: Number(task.resubmitCount || 0) || 0,
		lastRejectedAt: task.lastRejectedAt || null,
		lastResubmittedAt: task.lastResubmittedAt || null,
		resumeOriginalName: task.resumeOriginalName || null,
		resumeExpectedName: task.resumeExpectedName || null,
		resumeCleanedName: task.resumeCleanedName || null,
		resumeRenamed: Boolean(task.resumeRenamed),
		resumeMismatch: Boolean(task.resumeMismatch),
	};
}

function serializeAiUsageRow(doc) {
	if (!doc) return null;
	return {
		id: String(doc._id),
		feature: doc.feature || null,
		provider: doc.provider || null,
		requestedModel: doc.requestedModel || null,
		billedModel: doc.billedModel || null,
		inputTokens: Number(doc.inputTokens || 0) || 0,
		cachedInputTokens: Number(doc.cachedInputTokens || 0) || 0,
		outputTokens: Number(doc.outputTokens || 0) || 0,
		totalTokens: Number(doc.totalTokens || 0) || 0,
		costUsd: typeof doc.costUsd === "number" ? doc.costUsd : null,
		success: doc.success !== false,
		durationMs: typeof doc.durationMs === "number" ? doc.durationMs : null,
		applierName: doc.applierName || null,
		jobId: doc.jobId || null,
		createdAt:
			doc.createdAt instanceof Date
				? doc.createdAt.toISOString()
				: doc.createdAt ?? null,
	};
}

async function listTasksForApplier(applierName) {
	const collection = getVendorTasksCollection();
	if (!collection) {
		throw new Error("MongoDB is not connected.");
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

		if (job.completed && base.progress !== "completed" && base.status !== "skipped") {
			return { ...base, status: "done", progress: "completed" };
		}
		return base;
	});

	await Promise.all(
		tasks
			.filter((t) => t.progress === "completed" && t.jobId)
			.map((t) => upsertJobBidStatus(applierName, t.jobId, { bidCompleted: true })),
	);

	return tasks;
}

async function upsertVendorTaskRecording(applierName, jobId, fields) {
	const collection = getVendorTasksCollection();
	if (!collection) throw new Error("MongoDB is not connected.");

	const now = new Date();
	const $set = {
		applierName,
		jobId: String(jobId),
		updatedAt: now,
	};
	for (const [key, value] of Object.entries(fields || {})) {
		if (value !== undefined) $set[key] = value;
	}

	const result = await collection.findOneAndUpdate(
		{ applierName, jobId: String(jobId) },
		{
			$set,
			$setOnInsert: { addedAt: now },
		},
		{ upsert: true, returnDocument: "after" },
	);
	return result?.value ?? result;
}

async function findVendorTaskDoc(collection, applierName, rawId) {
	let doc = null;
	if (ObjectId.isValid(rawId)) {
		doc = await collection.findOne({ _id: new ObjectId(rawId), applierName });
	}
	if (!doc) {
		doc = await collection.findOne({ applierName, jobId: rawId });
	}
	return doc;
}

function uiStatusFromDoc(doc) {
	return deriveBidUiStatus(serializeTask(doc));
}

function computeBiddingDurationSec(doc, now = new Date()) {
	const start = doc?.bidderInProcessAt;
	if (!start) return null;
	const startMs = start instanceof Date ? start.getTime() : new Date(start).getTime();
	if (!Number.isFinite(startMs)) return null;
	return Math.max(0, Math.round((now.getTime() - startMs) / 1000));
}

/**
 * GET /bid-results?applierName=
 */
export async function listBidResults(req, res) {
	try {
		const applierName = String(req.query.applierName ?? "").trim();
		if (!applierName) {
			return res.status(400).json({ success: false, error: "applierName is required." });
		}

		const tasks = await listTasksForApplier(applierName);
		const results = tasks.map(mapTaskToBidResult).filter(Boolean);

		return res.json({ success: true, results, total: results.length });
	} catch (err) {
		console.error("[bid-results] list failed", err);
		return res.status(500).json({
			success: false,
			error: err.message || "Failed to list bid results.",
		});
	}
}

/**
 * GET /bid-results/rejected?applierName=
 */
export async function listRejectedBidResults(req, res) {
	try {
		const applierName = String(req.query.applierName ?? "").trim();
		if (!applierName) {
			return res.status(400).json({ success: false, error: "applierName is required." });
		}

		const collection = getVendorTasksCollection();
		if (!collection) {
			return res.status(503).json({ success: false, error: "MongoDB is not connected." });
		}

		const docs = await collection
			.find({ applierName, reviewStatus: "rejected" })
			.sort({ lastRejectedAt: -1, updatedAt: -1 })
			.limit(500)
			.toArray();

		const results = await Promise.all(
			docs.map(async (doc) => {
				const task = await withStableBidReadyDate(serializeTask(doc), applierName);
				return mapTaskToBidResult(task);
			}),
		);
		return res.json({
			success: true,
			results: results.filter(Boolean),
			total: results.filter(Boolean).length,
		});
	} catch (err) {
		console.error("[bid-results] list rejected failed", err);
		return res.status(500).json({
			success: false,
			error: err.message || "Failed to list rejected bids.",
		});
	}
}

/**
 * GET /bid-results/stats?applierName=&since=&until=
 * Per-owner-applier KPIs for Vendor Monitor / Bid Management.
 * Optional since/until (ISO) filter on updatedAt / lastRejectedAt / completedAt / addedAt.
 */
export async function getBidResultStats(req, res) {
	try {
		const applierName = String(req.query.applierName ?? "").trim();
		if (!applierName) {
			return res.status(400).json({ success: false, error: "applierName is required." });
		}

		const sinceRaw = String(req.query.since ?? "").trim();
		const untilRaw = String(req.query.until ?? "").trim();
		const since = sinceRaw ? new Date(sinceRaw) : null;
		const until = untilRaw ? new Date(untilRaw) : null;
		if (since && Number.isNaN(since.getTime())) {
			return res.status(400).json({ success: false, error: "since must be a valid ISO date." });
		}
		if (until && Number.isNaN(until.getTime())) {
			return res.status(400).json({ success: false, error: "until must be a valid ISO date." });
		}

		const collection = getVendorTasksCollection();
		if (!collection) {
			return res.status(503).json({ success: false, error: "MongoDB is not connected." });
		}

		const docs = await collection.find({ applierName }).limit(5000).toArray();

		const inWindow = (doc) => {
			if (!since && !until) return true;
			const stamps = [
				doc.updatedAt,
				doc.lastRejectedAt,
				doc.lastResubmittedAt,
				doc.completedAt,
				doc.addedAt,
			]
				.map((v) => {
					if (!v) return null;
					const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
					return Number.isFinite(t) ? t : null;
				})
				.filter((t) => t != null);
			if (stamps.length === 0) return !since && !until;
			const latest = Math.max(...stamps);
			if (since && latest < since.getTime()) return false;
			if (until && latest > until.getTime()) return false;
			return true;
		};

		const scoped = docs.filter(inWindow);
		let submitted = 0;
		let skipped = 0;
		let rejected = 0;
		let reviewed = 0;
		let rejectFromSubmitted = 0;
		let rejectFromSkipped = 0;
		let resubmitTotal = 0;
		let rejectTotal = 0;
		let realRejects = 0;
		let bidTimeSum = 0;
		let bidTimeCount = 0;

		for (const doc of scoped) {
			const ui = deriveBidUiStatus(serializeTask(doc));
			if (ui === "submitted") submitted += 1;
			else if (ui === "skipped") skipped += 1;
			else if (ui === "rejected") rejected += 1;
			else if (ui === "reviewed") reviewed += 1;

			const rejectCount = Number(doc.rejectCount || 0) || 0;
			const resubmitCount = Number(doc.resubmitCount || 0) || 0;
			rejectTotal += rejectCount;
			resubmitTotal += resubmitCount;
			if (rejectCount > 0 && resubmitCount > 0) {
				realRejects += Math.min(rejectCount, resubmitCount);
			}
			if (doc.rejectSource === "skipped") rejectFromSkipped += 1;
			else if (doc.rejectSource === "submitted") rejectFromSubmitted += 1;

			if (typeof doc.biddingDurationSec === "number" && Number.isFinite(doc.biddingDurationSec)) {
				bidTimeSum += doc.biddingDurationSec;
				bidTimeCount += 1;
			}
		}

		const decided = submitted + reviewed + rejected + skipped;
		const rejectionRate = decided > 0 ? rejected / decided : 0;
		const realRejectRate = rejectTotal > 0 ? realRejects / rejectTotal : 0;

		return res.json({
			success: true,
			stats: {
				totalTasks: scoped.length,
				submitted,
				reviewed,
				rejected,
				skipped,
				rejectFromSubmitted,
				rejectFromSkipped,
				rejectCount: rejectTotal,
				resubmitCount: resubmitTotal,
				realRejects,
				rejectionRate,
				realRejectRate,
				avgBiddingDurationSec: bidTimeCount > 0 ? Math.round(bidTimeSum / bidTimeCount) : null,
				biddingDurationSamples: bidTimeCount,
				since: since ? since.toISOString() : null,
				until: until ? until.toISOString() : null,
			},
		});
	} catch (err) {
		console.error("[bid-results] stats failed", err);
		return res.status(500).json({
			success: false,
			error: err.message || "Failed to load bid stats.",
		});
	}
}

/**
 * GET /bid-results/:id/events?applierName=
 */
export async function getBidResultEvents(req, res) {
	try {
		const rawId = String(req.params.id ?? "").trim().replace(/^bid-/, "");
		const applierName = String(req.query.applierName ?? "").trim();
		if (!applierName) {
			return res.status(400).json({ success: false, error: "applierName is required." });
		}
		if (!rawId) {
			return res.status(400).json({ success: false, error: "id is required." });
		}

		const collection = getVendorTasksCollection();
		if (!collection) {
			return res.status(503).json({ success: false, error: "MongoDB is not connected." });
		}

		const doc = await findVendorTaskDoc(collection, applierName, rawId);
		const taskId = doc?._id ? String(doc._id) : ObjectId.isValid(rawId) ? rawId : null;
		const jobId = doc?.jobId ? String(doc.jobId) : rawId;

		const events = await listBidReviewEvents({
			applierName,
			taskId,
			jobId,
		});

		return res.json({ success: true, events, total: events.length });
	} catch (err) {
		console.error("[bid-results] events failed", err);
		return res.status(500).json({
			success: false,
			error: err.message || "Failed to load events.",
		});
	}
}

/**
 * PATCH /bid-results/:id
 * body: { applierName, status, rejectReason? }
 * Supports submitted|reviewed|rejected; skipped→rejected; undo rejected→submitted/reviewed.
 */
export async function updateBidResultStatus(req, res) {
	try {
		const rawId = String(req.params.id ?? "").trim().replace(/^bid-/, "");
		const applierName = String(req.body?.applierName ?? req.query?.applierName ?? "").trim();
		const status = String(req.body?.status ?? "").trim();
		const rejectReasonRaw = req.body?.rejectReason;
		const rejectReason =
			typeof rejectReasonRaw === "string" ? rejectReasonRaw.trim().slice(0, 2000) : "";

		if (!REVIEW_STATUSES.has(status)) {
			return res
				.status(400)
				.json({ success: false, error: "status must be submitted, reviewed, or rejected." });
		}
		if (!applierName) {
			return res.status(400).json({ success: false, error: "applierName is required." });
		}

		const collection = getVendorTasksCollection();
		if (!collection) {
			return res.status(503).json({ success: false, error: "MongoDB is not connected." });
		}

		const existing = await findVendorTaskDoc(collection, applierName, rawId);
		const fromStatus = existing ? uiStatusFromDoc(existing) : "pending";
		const now = new Date();

		/** @type {Record<string, unknown>} */
		const $set = { reviewStatus: status, updatedAt: now, jobId: existing?.jobId || rawId, applierName };
		/** @type {Record<string, unknown>|null} */
		let $inc = null;
		let eventType = null;
		let rejectSource = null;

		if (status === "rejected") {
			const fromSkipped =
				fromStatus === "skipped" ||
				existing?.status === "skipped" ||
				(!existing && false);
			rejectSource = fromSkipped ? "skipped" : "submitted";
			$set.rejectSource = rejectSource;
			$set.rejectReason = rejectReason || null;
			$set.lastRejectedAt = now;
			$inc = { rejectCount: 1 };
			eventType = fromSkipped ? "skip_to_reject" : "reviewer_reject";
		} else if (fromStatus === "rejected") {
			// Reviewer undo — not a real reject / not mark-fixed.
			eventType = "reviewer_undo";
			$set.rejectReason = null;
		} else if (status === "reviewed") {
			eventType = "reviewer_mark_reviewed";
		}

		const filter = existing?._id
			? { _id: existing._id, applierName }
			: { applierName, jobId: rawId };

		const update = { $set };
		if ($inc) update.$inc = $inc;
		if (!existing) {
			update.$setOnInsert = { addedAt: now };
		}

		const result = await collection.findOneAndUpdate(filter, update, {
			upsert: true,
			returnDocument: "after",
		});
		const doc = result?.value ?? result;

		if (eventType) {
			await appendBidReviewEvent({
				taskId: doc?._id ? String(doc._id) : null,
				jobId: doc?.jobId || rawId,
				applierName,
				eventType,
				fromStatus,
				toStatus: status,
				actorType: "reviewer",
				rejectReason: status === "rejected" ? rejectReason || null : null,
				rejectSource,
			});
		}

		const task = await withStableBidReadyDate(serializeTask(doc), applierName);
		const mapped = mapTaskToBidResult(task);
		return res.json({ success: true, result: mapped });
	} catch (err) {
		console.error("[bid-results] patch failed", err);
		return res.status(500).json({
			success: false,
			error: err.message || "Failed to update bid result.",
		});
	}
}

/**
 * POST /bid-results/mark-fixed
 * body: { applierName, jobId? | id? }
 * Rejected → Submitted (incl. skip-origin). Increments resubmitCount.
 */
export async function markFixedBidResult(req, res) {
	try {
		const applierName = String(req.body?.applierName ?? "").trim();
		const rawId = String(req.body?.jobId ?? req.body?.id ?? "")
			.trim()
			.replace(/^bid-/, "");
		if (!applierName || !rawId) {
			return res
				.status(400)
				.json({ success: false, error: "applierName and jobId (or id) are required." });
		}

		const collection = getVendorTasksCollection();
		if (!collection) {
			return res.status(503).json({ success: false, error: "MongoDB is not connected." });
		}

		const existing = await findVendorTaskDoc(collection, applierName, rawId);
		if (!existing) {
			return res.status(404).json({ success: false, error: "Bid result not found." });
		}
		if (existing.reviewStatus !== "rejected") {
			return res.status(400).json({
				success: false,
				error: "Only rejected bids can be marked fixed.",
			});
		}

		const fromStatus = uiStatusFromDoc(existing);
		const now = new Date();
		const rejectSource =
			existing.rejectSource === "skipped" || existing.rejectSource === "submitted"
				? existing.rejectSource
				: existing.status === "skipped"
					? "skipped"
					: "submitted";

		const result = await collection.findOneAndUpdate(
			{ _id: existing._id, applierName },
			{
				$set: {
					reviewStatus: "submitted",
					status: "done",
					completedAt: existing.completedAt || now,
					bidderInProcess: false,
					updatedAt: now,
					lastResubmittedAt: now,
					rejectReason: null,
					// Keep rejectSource for analytics / future hybrid switch.
					rejectSource,
				},
				$inc: { resubmitCount: 1 },
			},
			{ returnDocument: "after" },
		);
		const doc = result?.value ?? result;

		// Do not restamp bidReadyDate — keep the original Bid Management folder day.
		await upsertJobBidStatus(applierName, String(doc.jobId || rawId), {
			bidCompleted: true,
		});

		await appendBidReviewEvent({
			taskId: String(doc._id),
			jobId: doc.jobId || rawId,
			applierName,
			eventType: "vendor_mark_fixed",
			fromStatus,
			toStatus: "submitted",
			actorType: "vendor",
			rejectSource,
		});

		const task = await withStableBidReadyDate(serializeTask(doc), applierName);
		return res.json({ success: true, result: mapTaskToBidResult(task), task });
	} catch (err) {
		console.error("[bid-results] mark-fixed failed", err);
		return res.status(500).json({
			success: false,
			error: err.message || "Failed to mark bid fixed.",
		});
	}
}

/**
 * POST /bid-results/start
 * Mark a Bid Ready job as in-process when Bid-Monitor Apply starts.
 */
export async function startBidResult(req, res) {
	try {
		const applierName = String(req.body?.applierName ?? "").trim();
		const jobId = String(req.body?.jobId ?? "").trim();
		const sessionId = String(req.body?.sessionId ?? "").trim() || null;
		const bidderName = String(req.body?.bidderName ?? "").trim() || null;
		const applyUrl = String(req.body?.applyUrl ?? "").trim() || null;
		if (!applierName || !jobId) {
			return res
				.status(400)
				.json({ success: false, error: "applierName and jobId are required." });
		}

		const now = new Date();
		const fields = {
			bidderInProcess: true,
			bidderInProcessAt: now,
			bidderName: bidderName || undefined,
			bidSessionId: sessionId || undefined,
			status: "pending",
		};
		if (applyUrl) fields.applyUrl = applyUrl;

		const objectId = toObjectId(jobId);
		if (objectId && jobsCollection) {
			const job = await jobsCollection.findOne(
				{ _id: objectId },
				{ projection: { title: 1, company: 1, applyLink: 1, applyUrl: 1, source: 1 } },
			);
			if (job) {
				fields.title = job.title || undefined;
				fields.company = companyDisplayName(job.company);
				fields.applyUrl = applyUrl || job.applyLink || job.applyUrl || undefined;
				fields.source = job.source || detectJobSource(fields.applyUrl)?.label || undefined;
			}
		}

		const readyAt = await getJobBidReadyDate(applierName, jobId);
		if (readyAt) fields.bidReadyDate = readyAt;

		const doc = await upsertVendorTaskRecording(applierName, jobId, fields);
		// Ensure bid-ready exists without moving the folder day.
		await upsertJobBidStatus(applierName, jobId, { bidReady: true });

		await appendBidReviewEvent({
			taskId: doc?._id ? String(doc._id) : null,
			jobId,
			applierName,
			eventType: "apply_start",
			fromStatus: "pending",
			toStatus: "in_process",
			actorType: "vendor",
			actorName: bidderName,
		});

		const task = await withStableBidReadyDate(serializeTask(doc), applierName);
		return res.json({ success: true, task });
	} catch (err) {
		console.error("[bid-results] start failed", err);
		return res.status(500).json({
			success: false,
			error: err.message || "Failed to start bid.",
		});
	}
}

/**
 * POST /bid-recordings/upload
 */
export async function uploadBidRecording(req, res) {
	try {
		const applierName = String(req.body?.applierName ?? "").trim();
		const jobId = String(req.body?.jobId ?? "").trim();
		const sessionId = String(req.body?.sessionId ?? "").trim() || `sess-${Date.now()}`;
		const applyUrl = String(req.body?.applyUrl ?? "").trim() || null;
		const bidderName = String(req.body?.bidderName ?? "").trim() || null;
		const contentType = String(req.body?.contentType ?? "video/webm").trim();
		const fileName = String(req.body?.fileName ?? "").trim();
		const videoBase64 = String(req.body?.videoBase64 ?? "").trim();
		const markCompleted = Boolean(req.body?.markCompleted);
		const durationSec =
			typeof req.body?.durationSec === "number" && Number.isFinite(req.body.durationSec)
				? Math.max(0, Math.round(req.body.durationSec))
				: null;
		const parseDate = (value) => {
			if (!value) return null;
			const d = new Date(value);
			return Number.isNaN(d.getTime()) ? null : d;
		};
		const recordingStartedAt = parseDate(req.body?.recordedStartAt);
		const recordingEndedAt = parseDate(req.body?.recordedEndAt);

		if (!applierName || !jobId) {
			return res
				.status(400)
				.json({ success: false, error: "applierName and jobId are required." });
		}
		if (!videoBase64) {
			return res.status(400).json({ success: false, error: "videoBase64 is required." });
		}

		let buffer;
		try {
			buffer = Buffer.from(videoBase64, "base64");
		} catch {
			return res.status(400).json({ success: false, error: "Invalid videoBase64." });
		}
		if (!buffer.length) {
			return res.status(400).json({ success: false, error: "Empty video payload." });
		}

		const uploaded = await uploadBidRecordingObject({
			applierName,
			sessionId,
			buffer,
			contentType,
			fileName,
		});

		const collection = getVendorTasksCollection();
		const existing = collection
			? await collection.findOne({ applierName, jobId: String(jobId) })
			: null;

		const now = new Date();
		const fields = {
			bidderName: bidderName || undefined,
			bidSessionId: sessionId,
			recordingPath: uploaded.storagePath,
			recordingContentType: uploaded.contentType,
			recordingSize: uploaded.sizeBytes,
			recordingDurationSec: durationSec,
			recordingStartedAt: recordingStartedAt || undefined,
			recordingEndedAt: recordingEndedAt || undefined,
		};
		if (applyUrl) fields.applyUrl = applyUrl;
		if (markCompleted) {
			fields.status = "done";
			fields.completedAt = now;
			fields.bidderInProcess = false;
			fields.reviewStatus = "submitted";
			fields.biddingDurationSec = computeBiddingDurationSec(existing, now);
		} else {
			fields.bidderInProcess = true;
			fields.status = "pending";
		}

		const readyAt = await getJobBidReadyDate(applierName, jobId);
		if (readyAt) fields.bidReadyDate = readyAt;

		const doc = await upsertVendorTaskRecording(applierName, jobId, fields);
		if (markCompleted) {
			await upsertJobBidStatus(applierName, jobId, { bidCompleted: true });
			await appendBidReviewEvent({
				taskId: doc?._id ? String(doc._id) : null,
				jobId,
				applierName,
				eventType: "submit",
				fromStatus: "in_process",
				toStatus: "submitted",
				actorType: "vendor",
				actorName: bidderName,
				meta: {
					biddingDurationSec: fields.biddingDurationSec ?? null,
				},
			});
		} else {
			await upsertJobBidStatus(applierName, jobId, { bidReady: true });
		}

		const task = await withStableBidReadyDate(serializeTask(doc), applierName);
		return res.json({
			success: true,
			recording: {
				storagePath: uploaded.storagePath,
				contentType: uploaded.contentType,
				sizeBytes: uploaded.sizeBytes,
				sessionId,
			},
			task,
			result: mapTaskToBidResult(task),
		});
	} catch (err) {
		console.error("[bid-recordings] upload failed", err);
		return res.status(500).json({
			success: false,
			error: err.message || "Failed to upload recording.",
		});
	}
}

/**
 * POST /bid-results/complete
 * body: { applierName, jobId, bidderName?, biddingDurationSec? }
 */
export async function completeBidResult(req, res) {
	try {
		const applierName = String(req.body?.applierName ?? "").trim();
		const jobId = String(req.body?.jobId ?? "").trim();
		const bidderName = String(req.body?.bidderName ?? "").trim() || null;
		if (!applierName || !jobId) {
			return res
				.status(400)
				.json({ success: false, error: "applierName and jobId are required." });
		}

		const collection = getVendorTasksCollection();
		const existing = collection
			? await collection.findOne({ applierName, jobId: String(jobId) })
			: null;

		const now = new Date();
		let biddingDurationSec =
			typeof req.body?.biddingDurationSec === "number" &&
			Number.isFinite(req.body.biddingDurationSec)
				? Math.max(0, Math.round(req.body.biddingDurationSec))
				: computeBiddingDurationSec(existing, now);

		const readyAt = await getJobBidReadyDate(applierName, jobId);
		const doc = await upsertVendorTaskRecording(applierName, jobId, {
			status: "done",
			completedAt: now,
			bidderInProcess: false,
			reviewStatus: "submitted",
			bidderName: bidderName || undefined,
			biddingDurationSec,
			...(readyAt ? { bidReadyDate: readyAt } : {}),
		});
		await upsertJobBidStatus(applierName, jobId, { bidCompleted: true });

		await appendBidReviewEvent({
			taskId: doc?._id ? String(doc._id) : null,
			jobId,
			applierName,
			eventType: "submit",
			fromStatus: "in_process",
			toStatus: "submitted",
			actorType: "vendor",
			actorName: bidderName,
			meta: { biddingDurationSec },
		});

		const task = await withStableBidReadyDate(serializeTask(doc), applierName);
		return res.json({ success: true, task, result: mapTaskToBidResult(task) });
	} catch (err) {
		console.error("[bid-results] complete failed", err);
		return res.status(500).json({
			success: false,
			error: err.message || "Failed to complete bid.",
		});
	}
}

/**
 * POST /bid-results/flags
 */
export async function saveBidResultFlags(req, res) {
	try {
		const applierName = String(req.body?.applierName ?? "").trim();
		const jobId = String(req.body?.jobId ?? "").trim();
		if (!applierName || !jobId) {
			return res
				.status(400)
				.json({ success: false, error: "applierName and jobId are required." });
		}

		const flagsIn = req.body?.flags && typeof req.body.flags === "object" ? req.body.flags : {};
		const normalizeVerdict = (v) => {
			if (!v || typeof v !== "object") return null;
			const status = v.status === "red" || v.status === "green" ? v.status : null;
			if (!status) return null;
			return {
				status,
				explanation: typeof v.explanation === "string" ? v.explanation : "",
			};
		};
		const flags = {
			remote: normalizeVerdict(flagsIn.remote),
			clearance: normalizeVerdict(flagsIn.clearance),
		};
		const summary =
			typeof req.body?.summary === "string" ? req.body.summary.trim().slice(0, 4000) : undefined;

		const fields = { flags };
		if (summary !== undefined) fields.analysisSummary = summary || null;

		const doc = await upsertVendorTaskRecording(applierName, jobId, fields);

		await appendBidReviewEvent({
			taskId: doc?._id ? String(doc._id) : null,
			jobId,
			applierName,
			eventType: "analyze",
			fromStatus: null,
			toStatus: null,
			actorType: "vendor",
			actorName: applierName,
			meta: {
				flags,
				summary: fields.analysisSummary ?? null,
			},
		});

		const task = serializeTask(doc);
		return res.json({ success: true, task, result: mapTaskToBidResult(task) });
	} catch (err) {
		console.error("[bid-results] flags failed", err);
		return res.status(500).json({
			success: false,
			error: err.message || "Failed to save flags.",
		});
	}
}

/**
 * POST /bid-results/skip
 * biddingDurationSec is null on skip.
 */
export async function skipBidResult(req, res) {
	try {
		const applierName = String(req.body?.applierName ?? "").trim();
		const jobId = String(req.body?.jobId ?? "").trim();
		const bidderName = String(req.body?.bidderName ?? "").trim() || null;
		if (!applierName || !jobId) {
			return res
				.status(400)
				.json({ success: false, error: "applierName and jobId are required." });
		}

		const now = new Date();
		const readyAt = await getJobBidReadyDate(applierName, jobId);
		const doc = await upsertVendorTaskRecording(applierName, jobId, {
			status: "skipped",
			completedAt: now,
			bidderInProcess: false,
			reviewStatus: null,
			bidderName: bidderName || undefined,
			biddingDurationSec: null,
			...(readyAt ? { bidReadyDate: readyAt } : {}),
		});

		await appendBidReviewEvent({
			taskId: doc?._id ? String(doc._id) : null,
			jobId,
			applierName,
			eventType: "skip",
			fromStatus: "in_process",
			toStatus: "skipped",
			actorType: "vendor",
			actorName: bidderName,
			meta: { biddingDurationSec: null },
		});

		const task = await withStableBidReadyDate(serializeTask(doc), applierName);
		return res.json({ success: true, task, result: mapTaskToBidResult(task) });
	} catch (err) {
		console.error("[bid-results] skip failed", err);
		return res.status(500).json({
			success: false,
			error: err.message || "Failed to skip bid.",
		});
	}
}

/**
 * POST /bid-results/resume-audit
 * Persist hooked original vs canonical expected name (P2).
 * body: { applierName, jobId, originalName, expectedName?, cleanedName?, renamed?, pageUrl? }
 */
export async function saveResumeAudit(req, res) {
	try {
		const applierName = String(req.body?.applierName ?? "").trim();
		const jobId = String(req.body?.jobId ?? "").trim();
		const originalName = resumeBasename(req.body?.originalName);
		if (!applierName || !jobId || !originalName) {
			return res.status(400).json({
				success: false,
				error: "applierName, jobId, and originalName are required.",
			});
		}

		const collection = getVendorTasksCollection();
		const existing = collection
			? await collection.findOne({ applierName, jobId: String(jobId) })
			: null;

		const company = companyDisplayName(existing?.company || req.body?.company);
		const title = String(existing?.title || req.body?.title || "Untitled role");
		const extMatch = originalName.match(/\.[^.]+$/);
		const ext = extMatch ? extMatch[0] : ".pdf";

		const expectedName =
			resumeBasename(req.body?.expectedName) ||
			buildCanonicalResumeFileName(company, title, applierName, jobId, ext);

		const profileBase = profileNameToFileBase(applierName);
		const cleanedName =
			resumeBasename(req.body?.cleanedName) ||
			(profileBase ? `${profileBase}${ext}` : originalName);

		const renamed =
			typeof req.body?.renamed === "boolean"
				? req.body.renamed
				: cleanedName !== originalName;
		const mismatch = isResumeNameMismatch(originalName, expectedName);
		const recommendedStack =
			typeof existing?.recommendedResumeStack === "string"
				? existing.recommendedResumeStack
				: null;
		const resumeStackMatch = matchUploadToRecommended(originalName, recommendedStack);

		const doc = await upsertVendorTaskRecording(applierName, jobId, {
			resumeOriginalName: originalName,
			resumeExpectedName: expectedName,
			resumeCleanedName: cleanedName,
			resumeRenamed: renamed,
			resumeMismatch: mismatch,
			resumeStackMatch,
			title: existing?.title || title,
			company: existing?.company || company,
		});

		if (mismatch) {
			await appendBidReviewEvent({
				taskId: doc?._id ? String(doc._id) : null,
				jobId,
				applierName,
				eventType: "resume_name_mismatch",
				fromStatus: null,
				toStatus: null,
				actorType: "system",
				meta: {
					originalName,
					expectedName,
					cleanedName,
					renamed,
					mismatch,
					resumeStackMatch,
					recommendedResumeStack: recommendedStack,
					pageUrl: typeof req.body?.pageUrl === "string" ? req.body.pageUrl : null,
				},
			});
		}

		const task = serializeTask(doc);
		return res.json({
			success: true,
			audit: {
				originalName,
				expectedName,
				cleanedName,
				renamed,
				mismatch,
			},
			result: mapTaskToBidResult(task),
			task,
		});
	} catch (err) {
		console.error("[bid-results] resume-audit failed", err);
		return res.status(500).json({
			success: false,
			error: err.message || "Failed to save resume audit.",
		});
	}
}

/**
 * GET /bid-results/resumes.zip?applierName=&jobIds=id1,id2
 * Bulk zip of generated résumés with canonical folder/file names. No size/count limits.
 */
export async function downloadBidResumesZip(req, res) {
	try {
		const applierName = String(req.query.applierName ?? "").trim();
		const jobIdsRaw = String(req.query.jobIds ?? "").trim();
		if (!applierName) {
			return res.status(400).json({ success: false, error: "applierName is required." });
		}

		const jobIds = jobIdsRaw
			? jobIdsRaw.split(",").map((s) => s.trim()).filter(Boolean)
			: [];

		// Lazy import so zip dependency stays optional at module load.
		const { buildBidResumesZip } = await import("../services/bidResumesZipService.js");
		const built = await buildBidResumesZip({ applierName, jobIds });
		if (!built.ok) {
			return res.status(built.status || 400).json({ success: false, error: built.error });
		}

		res.setHeader("Content-Type", "application/zip");
		res.setHeader(
			"Content-Disposition",
			`attachment; filename="${built.fileName.replace(/"/g, "")}"`,
		);
		return res.send(built.buffer);
	} catch (err) {
		console.error("[bid-results] resumes.zip failed", err);
		return res.status(500).json({
			success: false,
			error: err.message || "Failed to build resumes zip.",
		});
	}
}

/**
 * GET /bid-results/:id/ai-usage?applierName=
 * Per-bid LLM call history from ai_api_usage (jobId scoped).
 */
export async function getBidResultAiUsage(req, res) {
	try {
		const rawId = String(req.params.id ?? "").trim().replace(/^bid-/, "");
		const applierName = String(req.query.applierName ?? "").trim();
		if (!applierName) {
			return res.status(400).json({ success: false, error: "applierName is required." });
		}
		if (!rawId) {
			return res.status(400).json({ success: false, error: "id is required." });
		}
		if (!llmCallLogCollection) {
			return res.status(503).json({ success: false, error: "MongoDB is not connected." });
		}

		const collection = getVendorTasksCollection();
		if (!collection) {
			return res.status(503).json({ success: false, error: "MongoDB is not connected." });
		}

		const doc = await findVendorTaskDoc(collection, applierName, rawId);
		const jobId = doc?.jobId ? String(doc.jobId) : rawId;
		const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);

		const rows = await llmCallLogCollection
			.find({ jobId: String(jobId) })
			.sort({ createdAt: -1 })
			.limit(limit)
			.toArray();

		return res.json({
			success: true,
			jobId,
			applierName,
			rows: rows.map(serializeAiUsageRow).filter(Boolean),
			total: rows.length,
		});
	} catch (err) {
		console.error("[bid-results] ai-usage failed", err);
		return res.status(500).json({
			success: false,
			error: err.message || "Failed to load AI usage.",
		});
	}
}

export { mapTaskToBidResult, deriveBidUiStatus };
