import {
	startBidResult,
	completeBidResult,
	skipBidResult,
	beginBidRecordingUpload,
	completeBidRecordingUpload,
} from "./bidResultsController.js";
import { persistBidPageAnalysis } from "../services/bidAiArtifactPersist.js";

function withSessionApplier(req) {
	const applierName = String(req.athensLensSession?.applierName || "").trim();
	const bidderName = String(
		req.body?.bidderName
			|| req.athensLensSession?.username
			|| req.athensLensSession?.applierName
			|| "",
	).trim() || null;
	req.body = {
		...(req.body && typeof req.body === "object" ? req.body : {}),
		applierName,
		bidderName: bidderName || undefined,
	};
	return applierName;
}

/** POST /athens-lens/bids/start */
export async function startAthensLensBid(req, res) {
	if (!withSessionApplier(req)) {
		return res.status(401).json({ success: false, message: "Not signed in." });
	}
	return startBidResult(req, res);
}

/** POST /athens-lens/bids/complete */
export async function completeAthensLensBid(req, res) {
	if (!withSessionApplier(req)) {
		return res.status(401).json({ success: false, message: "Not signed in." });
	}
	return completeBidResult(req, res);
}

/** POST /athens-lens/bids/skip */
export async function skipAthensLensBid(req, res) {
	if (!withSessionApplier(req)) {
		return res.status(401).json({ success: false, message: "Not signed in." });
	}
	return skipBidResult(req, res);
}

/** POST /athens-lens/bids/recordings/uploads */
export async function beginAthensLensRecordingUpload(req, res) {
	if (!withSessionApplier(req)) {
		return res.status(401).json({ success: false, message: "Not signed in." });
	}
	// Reuse Bid-Monitor resumable upload; owner uid optional for Lens sessions.
	req.auth = { ...(req.auth || {}), uid: req.athensLensSession?.accountId || "" };
	return beginBidRecordingUpload(req, res);
}

/** POST /athens-lens/bids/recordings/uploads/:uploadId/complete */
export async function completeAthensLensRecordingUpload(req, res) {
	if (!withSessionApplier(req)) {
		return res.status(401).json({ success: false, message: "Not signed in." });
	}
	req.auth = { ...(req.auth || {}), uid: req.athensLensSession?.accountId || "" };
	return completeBidRecordingUpload(req, res);
}

/**
 * POST /athens-lens/bids/analysis
 * Persist Ask AI form answers onto the same vendor_tasks schema Bid Management reads.
 */
export async function saveAthensLensBidAnalysis(req, res) {
	try {
		const applierName = String(req.athensLensSession?.applierName || "").trim();
		const jobId = String(req.body?.jobId || "").trim();
		if (!applierName || !jobId) {
			return res.status(400).json({
				success: false,
				message: "jobId is required.",
			});
		}

		const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];
		const formAnswers = answers.map((entry) => ({
			question: entry?.question,
			suggestedAnswer: entry?.suggestedAnswer ?? entry?.answer,
			confidence: entry?.confidence,
		}));

		const doc = await persistBidPageAnalysis({
			applierName,
			jobId,
			result: {
				summary: req.body?.summary || "",
				formAnswers,
				pageUrl: req.body?.pageUrl || null,
				pageTitle: req.body?.pageTitle || null,
				isJobPage: true,
			},
			usage: req.body?.usage || null,
			mode: req.body?.mode === "heuristic" ? "heuristic" : "llm",
			call: {
				requestId: req.body?.requestId || null,
				provider: req.body?.provider || null,
				requestedModel: req.body?.requestedModel || null,
				billedModel: req.body?.billedModel || null,
			},
		});

		return res.json({
			success: true,
			jobId,
			formCount: formAnswers.length,
			taskId: doc?._id ? String(doc._id) : null,
		});
	} catch (error) {
		console.error("[athens-lens] save analysis failed", error?.message || error);
		return res.status(error?.status || 500).json({
			success: false,
			message: error?.message || "Unable to save AI answers.",
		});
	}
}
