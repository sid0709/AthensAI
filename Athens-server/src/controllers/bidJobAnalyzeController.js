import {
	analyzeJobFlags,
	analyzeJobPage,
	recommendResumeForJob,
} from "../services/bidJobAnalyzeService.js";
import { persistRecommendResumeResult } from "../services/bidRecommendPersist.js";
import {
	persistBidFlagAnalysis,
	persistBidPageAnalysis,
} from "../services/bidAiArtifactPersist.js";

function bindRequestAbort(req, res) {
	const controller = new AbortController();
	const abort = () => {
		if (!controller.signal.aborted) {
			controller.abort(Object.assign(new Error("Job analysis request disconnected"), { name: "AbortError" }));
		}
	};
	const close = () => {
		if (!res.writableEnded) abort();
	};
	const cleanup = () => {
		req.off("aborted", abort);
		res.off("close", close);
		res.off("finish", cleanup);
	};
	req.once("aborted", abort);
	res.once("close", close);
	res.once("finish", cleanup);
	return { signal: controller.signal, cleanup };
}

function throwIfAborted(signal) {
	if (!signal.aborted) return;
	throw signal.reason instanceof Error
		? signal.reason
		: Object.assign(new Error("Job analysis request cancelled"), { name: "AbortError" });
}

/**
 * POST /api/job-analyze/page
 * body: { pageContext, applierName?, sessionContext?, jobId? }
 */
export async function postJobAnalyzePage(req, res) {
	const requestAbort = bindRequestAbort(req, res);
	try {
		const pageContext = req.body?.pageContext;
		const applierName = String(req.body?.applierName ?? "").trim();
		const jobId = String(req.body?.jobId ?? "").trim() || undefined;
		const sessionContext =
			req.body?.sessionContext && typeof req.body.sessionContext === "object"
				? req.body.sessionContext
				: null;

		const {
			result,
			usage,
			mode,
			requestId,
			provider,
			requestedModel,
			billedModel,
		} = await analyzeJobPage({
			pageContext,
			applierName,
			sessionContext,
			jobId,
			signal: requestAbort.signal,
		});
		throwIfAborted(requestAbort.signal);
		if (jobId && applierName) {
			await persistBidPageAnalysis({
				applierName,
				jobId,
				result,
				usage,
				mode,
				call: { requestId, provider, requestedModel, billedModel },
			});
		}

		return res.json({
			ok: true,
			success: true,
			result,
			usage,
			mode,
			requestId: requestId || null,
		});
	} catch (err) {
		if (err?.name === "AbortError" || requestAbort.signal.aborted) return;
		console.error("[job-analyze/page] failed", err);
		return res.status(400).json({
			ok: false,
			success: false,
			error: err.message || "Page analysis failed.",
		});
	} finally {
		requestAbort.cleanup();
	}
}

/**
 * POST /api/job-analyze/flags
 * body: { pageContext, applierName?, sessionContext?, neededFlags?, jobId? }
 */
export async function postJobAnalyzeFlags(req, res) {
	const requestAbort = bindRequestAbort(req, res);
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

		const {
			result,
			usage,
			mode,
			requestId,
			provider,
			requestedModel,
			billedModel,
		} = await analyzeJobFlags({
			pageContext,
			applierName,
			sessionContext,
			neededFlags,
			jobId,
			signal: requestAbort.signal,
		});
		throwIfAborted(requestAbort.signal);
		if (jobId && applierName) {
			await persistBidFlagAnalysis({
				applierName,
				jobId,
				result,
				usage,
				mode,
				call: { requestId, provider, requestedModel, billedModel },
			});
		}

		return res.json({
			ok: true,
			success: true,
			result,
			usage,
			mode,
			requestId: requestId || null,
		});
	} catch (err) {
		if (err?.name === "AbortError" || requestAbort.signal.aborted) return;
		console.error("[job-analyze/flags] failed", err);
		return res.status(400).json({
			ok: false,
			success: false,
			error: err.message || "Flag analysis failed.",
		});
	} finally {
		requestAbort.cleanup();
	}
}

/**
 * POST /api/job-analyze/recommend-resume
 * body: { pageContext, applierName, jobId? }
 */
export async function postJobRecommendResume(req, res) {
	const requestAbort = bindRequestAbort(req, res);
	try {
		const pageContext = req.body?.pageContext;
		const applierName = String(req.body?.applierName ?? "").trim();
		const jobId = String(req.body?.jobId ?? "").trim() || undefined;

		const {
			result,
			usage,
			mode,
			requestId,
			provider,
			requestedModel,
			billedModel,
		} = await recommendResumeForJob({
			pageContext,
			applierName,
			jobId,
			signal: requestAbort.signal,
		});
		throwIfAborted(requestAbort.signal);

		if (jobId && applierName) {
			await persistRecommendResumeResult(applierName, jobId, result, {
				usage,
				mode,
				requestId,
				provider,
				requestedModel,
				billedModel,
			});
		}

		return res.json({
			ok: true,
			success: true,
			result,
			usage,
			mode,
			requestId: requestId || null,
		});
	} catch (err) {
		if (err?.name === "AbortError" || requestAbort.signal.aborted) return;
		console.error("[job-analyze/recommend-resume] failed", err);
		return res.status(400).json({
			ok: false,
			success: false,
			error: err.message || "Resume recommendation failed.",
		});
	} finally {
		requestAbort.cleanup();
	}
}
