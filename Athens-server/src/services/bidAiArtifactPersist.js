import { randomUUID } from "node:crypto";
import { getVendorTasksCollection } from "../db/dataStore.js";
import { appendBidReviewEvent } from "./bidReviewEventsService.js";

function cleanText(value, maxLength) {
	if (typeof value !== "string") return null;
	const text = value.trim();
	return text ? text.slice(0, maxLength) : null;
}

function finiteNumber(value) {
	const number = Number(value);
	return Number.isFinite(number) ? number : null;
}

export function normalizeBidAiUsage(usage, call = {}) {
	if (!usage && !call?.requestId) return null;
	return {
		requestId: cleanText(call?.requestId, 200),
		provider: cleanText(call?.provider, 80),
		requestedModel: cleanText(call?.requestedModel, 200),
		billedModel: cleanText(call?.billedModel || usage?.model, 200),
		inputTokens: finiteNumber(usage?.inputTokens) ?? 0,
		cachedTokens: finiteNumber(usage?.cachedTokens) ?? 0,
		outputTokens: finiteNumber(usage?.outputTokens) ?? 0,
		totalTokens: finiteNumber(usage?.totalTokens) ?? 0,
		costUsd: finiteNumber(usage?.cost),
	};
}

export function normalizeBidFormAnswers(answers) {
	if (!Array.isArray(answers)) return [];
	return answers
		.map((answer) => {
			const question = cleanText(answer?.question, 2000);
			const suggestedAnswer = cleanText(answer?.suggestedAnswer, 8000);
			if (!question || !suggestedAnswer) return null;
			const confidence = ["high", "medium", "low"].includes(answer?.confidence)
				? answer.confidence
				: null;
			return { question, suggestedAnswer, confidence };
		})
		.filter(Boolean);
}

export function normalizeBidFlags(flags) {
	const normalizeVerdict = (verdict) => {
		if (!verdict || typeof verdict !== "object") return null;
		const status = verdict.status === "green" || verdict.status === "red"
			? verdict.status
			: null;
		if (!status) return null;
		return {
			status,
			explanation: cleanText(verdict.explanation, 4000) || "",
		};
	};
	return {
		remote: normalizeVerdict(flags?.remote),
		clearance: normalizeVerdict(flags?.clearance),
	};
}

function callInfo(call, usage) {
	return normalizeBidAiUsage(usage, call);
}

async function updateLatestBidFields(applierName, jobId, fields) {
	const collection = getVendorTasksCollection();
	if (!collection) throw new Error("Database is not connected.");
	const now = new Date();
	const updated = await collection.findOneAndUpdate(
		{ applierName, jobId },
		{
			$set: { ...fields, updatedAt: now },
			$setOnInsert: {
				applierName,
				jobId,
				addedAt: now,
				status: "pending",
			},
		},
		{ upsert: true, returnDocument: "after" },
	);
	return updated?.value ?? updated;
}

function artifactIdentity(feature, call) {
	const requestId = cleanText(call?.requestId, 200);
	return {
		requestId,
		eventKey: requestId ? `ai:${requestId}` : `ai:${feature}:${randomUUID()}`,
	};
}

export async function persistBidPageAnalysis({
	applierName,
	jobId,
	result,
	usage,
	mode,
	call,
}) {
	const name = String(applierName || "").trim();
	const jid = String(jobId || "").trim();
	if (!name || !jid) return null;

	const analyzedAt = new Date();
	const summary = cleanText(result?.summary, 4000);
	const formAnswers = normalizeBidFormAnswers(result?.formAnswers);
	const pageUrl = cleanText(result?.pageUrl, 8000);
	const pageTitle = cleanText(result?.pageTitle, 2000);
	const normalizedMode = mode === "llm" ? "llm" : "heuristic";
	const normalizedUsage = callInfo(call, usage);
	const identity = artifactIdentity("bid-job-analyze", call);

	await appendBidReviewEvent({
		jobId: jid,
		applierName: name,
		eventType: "analyze_answers",
		eventKey: identity.eventKey,
		requestId: identity.requestId,
		feature: "bid-job-analyze",
		actorType: "vendor",
		actorName: name,
		meta: {
			mode: normalizedMode,
			summary,
			formAnswers,
			formCount: formAnswers.length,
			isJobPage: Boolean(result?.isJobPage),
			notJobPageReason: cleanText(result?.notJobPageReason, 2000),
			pageUrl,
			pageTitle,
			usage: normalizedUsage,
		},
	});

	return updateLatestBidFields(name, jid, {
		analysisSummary: summary,
		analysisFormAnswers: formAnswers,
		analysisMode: normalizedMode,
		analysisPageUrl: pageUrl,
		analysisPageTitle: pageTitle,
		analysisUsage: normalizedUsage,
		analysisRequestId: identity.requestId,
		analyzedAt,
	});
}

export async function persistBidFlagAnalysis({
	applierName,
	jobId,
	result,
	usage,
	mode,
	call,
}) {
	const name = String(applierName || "").trim();
	const jid = String(jobId || "").trim();
	if (!name || !jid) return null;

	const analyzedAt = new Date();
	const flags = normalizeBidFlags(result);
	const normalizedMode = mode === "llm" ? "llm" : "heuristic";
	const normalizedUsage = callInfo(call, usage);
	const identity = artifactIdentity("bid-job-flags", call);

	await appendBidReviewEvent({
		jobId: jid,
		applierName: name,
		eventType: "analyze_flags",
		eventKey: identity.eventKey,
		requestId: identity.requestId,
		feature: "bid-job-flags",
		actorType: "vendor",
		actorName: name,
		meta: {
			mode: normalizedMode,
			flags,
			usage: normalizedUsage,
		},
	});

	return updateLatestBidFields(name, jid, {
		flags,
		flagAnalysisMode: normalizedMode,
		flagAnalysisUsage: normalizedUsage,
		flagAnalysisRequestId: identity.requestId,
		flagAnalyzedAt: analyzedAt,
	});
}

