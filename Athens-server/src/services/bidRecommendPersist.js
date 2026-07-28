/**
 * Persist recommend-resume + stack-vs-upload compare onto vendor_tasks.
 */
import { randomUUID } from "node:crypto";
import { getVendorTasksCollection } from "../db/dataStore.js";
import { matchUploadToRecommended } from "../lib/resumeCatalogCompress.js";
import { normalizeBidAiUsage } from "./bidAiArtifactPersist.js";
import { appendBidReviewEvent } from "./bidReviewEventsService.js";

/**
 * Upsert recommend fields on vendor_tasks and append a review event.
 * @param {string} applierName
 * @param {string} jobId
 * @param {object} result — recommendResumeForJob result
 */
export async function persistRecommendResumeResult(applierName, jobId, result, call = {}) {
	const collection = getVendorTasksCollection();
	if (!collection) throw new Error("Database is not connected.");

	const name = String(applierName || "").trim();
	const jid = String(jobId || "").trim();
	if (!name || !jid) return null;

	const now = new Date();
	const recommendedResumeStack = result?.matchedCatalogKey || result?.recommendedResume || null;
	const useCustomizedResume = Boolean(result?.useCustomizedResume);
	const recommendWarning =
		typeof result?.warning === "string" && result.warning.trim()
			? result.warning.trim().slice(0, 1000)
			: null;
	const recommendedResumeReason =
		typeof result?.reason === "string" && result.reason.trim()
			? result.reason.trim().slice(0, 1000)
			: null;
	const requestId = String(call?.requestId || "").trim() || null;
	const recommendMode = call?.mode === "llm" ? "llm" : "heuristic";
	const recommendUsage = normalizeBidAiUsage(call?.usage, call);

	const existing = await collection.findOne({ applierName: name, jobId: jid });
	const resumeStackMatch = matchUploadToRecommended(
		existing?.resumeOriginalName,
		recommendedResumeStack,
	);

	const fields = {
		recommendedResumeStack,
		recommendedResumeReason,
		useCustomizedResume,
		recommendWarning,
		recommendedAt: now,
		recommendMode,
		recommendUsage,
		recommendRequestId: requestId,
		resumeStackMatch,
		updatedAt: now,
	};

	const update = {
		$set: fields,
		$setOnInsert: {
			applierName: name,
			jobId: jid,
			addedAt: now,
			status: "pending",
		},
	};

	const upsertResult = await collection.findOneAndUpdate(
		{ applierName: name, jobId: jid },
		update,
		{ upsert: true, returnDocument: "after" },
	);
	const doc = upsertResult?.value ?? upsertResult;

	await appendBidReviewEvent({
		taskId: doc?._id ? String(doc._id) : null,
		jobId: jid,
		applierName: name,
		eventType: "recommend_resume",
		fromStatus: null,
		toStatus: null,
		actorType: "vendor",
		actorName: name,
		eventKey: requestId
			? `ai:${requestId}`
			: `ai:bid-recommend-resume:${randomUUID()}`,
		requestId,
		feature: "bid-recommend-resume",
		meta: {
			recommendedResumeStack,
			useCustomizedResume,
			recommendWarning,
			reason: recommendedResumeReason,
			isJobDescription: Boolean(result?.isJobDescription),
			resumeStackMatch,
			mode: recommendMode,
			usage: recommendUsage,
		},
	});

	return doc;
}

/**
 * Recompute resumeStackMatch after resume-audit when a recommendation exists.
 */
export function computeResumeStackMatch(originalName, recommendedResumeStack) {
	return matchUploadToRecommended(originalName, recommendedResumeStack);
}
