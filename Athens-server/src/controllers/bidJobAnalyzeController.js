import {
	analyzeJobFlags,
	analyzeJobPage,
	recommendResumeForJob,
} from "../services/bidJobAnalyzeService.js";
import { persistRecommendResumeResult } from "../services/bidRecommendPersist.js";

/**
 * POST /api/job-analyze/page
 * body: { pageContext, applierName?, sessionContext?, jobId? }
 */
export async function postJobAnalyzePage(req, res) {
	try {
		const pageContext = req.body?.pageContext;
		const applierName = String(req.body?.applierName ?? "").trim();
		const jobId = String(req.body?.jobId ?? "").trim() || undefined;
		const sessionContext =
			req.body?.sessionContext && typeof req.body.sessionContext === "object"
				? req.body.sessionContext
				: null;

		const { result, usage, mode } = await analyzeJobPage({
			pageContext,
			applierName,
			sessionContext,
			jobId,
		});

		return res.json({ ok: true, success: true, result, usage, mode });
	} catch (err) {
		console.error("[job-analyze/page] failed", err);
		return res.status(400).json({
			ok: false,
			success: false,
			error: err.message || "Page analysis failed.",
		});
	}
}

/**
 * POST /api/job-analyze/flags
 * body: { pageContext, applierName?, sessionContext?, neededFlags?, jobId? }
 */
export async function postJobAnalyzeFlags(req, res) {
	try {
		const pageContext = req.body?.pageContext;
		const applierName = String(req.body?.applierName ?? "").trim();
		const jobId = String(req.body?.jobId ?? "").trim() || undefined;
		const sessionContext =
			req.body?.sessionContext && typeof req.body.sessionContext === "object"
				? req.body.sessionContext
				: null;
		const neededFlags = Array.isArray(req.body?.neededFlags)
			? req.body.neededFlags
			: ["remote", "clearance"];

		const { result, usage, mode } = await analyzeJobFlags({
			pageContext,
			applierName,
			sessionContext,
			neededFlags,
			jobId,
		});

		return res.json({ ok: true, success: true, result, usage, mode });
	} catch (err) {
		console.error("[job-analyze/flags] failed", err);
		return res.status(400).json({
			ok: false,
			success: false,
			error: err.message || "Flag analysis failed.",
		});
	}
}

/**
 * POST /api/job-analyze/recommend-resume
 * body: { pageContext, applierName, jobId? }
 */
export async function postJobRecommendResume(req, res) {
	try {
		const pageContext = req.body?.pageContext;
		const applierName = String(req.body?.applierName ?? "").trim();
		const jobId = String(req.body?.jobId ?? "").trim() || undefined;

		const { result, usage, mode } = await recommendResumeForJob({
			pageContext,
			applierName,
			jobId,
		});

		if (jobId && applierName) {
			try {
				await persistRecommendResumeResult(applierName, jobId, result);
			} catch (persistErr) {
				console.warn("[job-analyze/recommend-resume] persist failed", persistErr);
			}
		}

		return res.json({ ok: true, success: true, result, usage, mode });
	} catch (err) {
		console.error("[job-analyze/recommend-resume] failed", err);
		return res.status(400).json({
			ok: false,
			success: false,
			error: err.message || "Resume recommendation failed.",
		});
	}
}
