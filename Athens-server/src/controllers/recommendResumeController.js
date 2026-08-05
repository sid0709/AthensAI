/**
 * Bulk Library resume recommend for Bid Ready jobs.
 * Uses stored job description + resumeAnalysisCatalog via recommendResumeForJob.
 */
import { DocumentId } from "@nextoffer/shared/document-id";
import { jobsCollection } from "../db/dataStore.js";
import { recommendResumeForJob } from "../services/bidJobAnalyzeService.js";
import { persistRecommendResumeResult } from "../services/bidRecommendPersist.js";
import { plainText } from "../services/athensLensJobsService.js";

const MAX_JOBS = 40;
const CONCURRENCY = 2;

function asJobIds(raw) {
	if (!Array.isArray(raw)) return [];
	const out = [];
	const seen = new Set();
	for (const value of raw) {
		const id = String(value || "").trim();
		if (!id || seen.has(id) || !DocumentId.isValid(id)) continue;
		seen.add(id);
		out.push(id);
		if (out.length >= MAX_JOBS) break;
	}
	return out;
}

function extractJobDescription(job) {
	return plainText(job?.jobDescription || job?.description);
}

async function mapPool(items, limit, worker) {
	const results = new Array(items.length);
	let next = 0;
	async function run() {
		while (next < items.length) {
			const index = next++;
			results[index] = await worker(items[index], index);
		}
	}
	const runners = Array.from({ length: Math.min(limit, items.length) }, () => run());
	await Promise.all(runners);
	return results;
}

/**
 * POST /jobs/recommend-resumes
 * Body: { applierName, jobIds: string[] }
 */
export async function recommendResumesBulk(req, res) {
	try {
		if (!jobsCollection) {
			return res.status(503).json({ success: false, error: "Database not ready" });
		}

		const applierName = String(req.body?.applierName || "").trim();
		const jobIds = asJobIds(req.body?.jobIds);
		if (!applierName) {
			return res.status(400).json({ success: false, error: "applierName is required" });
		}
		if (!jobIds.length) {
			return res.status(400).json({ success: false, error: "jobIds are required" });
		}

		const objectIds = jobIds.map((id) => new DocumentId(id));
		const docs = await jobsCollection
			.find(
				{ _id: { $in: objectIds } },
				{ projection: { title: 1, jobDescription: 1, description: 1, applyLink: 1, jobLink: 1 } },
			)
			.toArray();
		const byId = new Map(docs.map((doc) => [String(doc._id), doc]));

		const results = await mapPool(jobIds, CONCURRENCY, async (jobId) => {
			const job = byId.get(jobId);
			if (!job) {
				return {
					jobId,
					ok: false,
					error: "Job not found",
					recommendedResumeStack: null,
					recommendedResumeReason: null,
					warning: null,
					mode: null,
				};
			}

			const jdText = extractJobDescription(job);
			if (!jdText) {
				return {
					jobId,
					ok: false,
					error: "Job has no description text",
					recommendedResumeStack: null,
					recommendedResumeReason: null,
					warning: "Add or scrape a job description before recommending.",
					mode: "heuristic",
				};
			}

			try {
				const pageContext = {
					visibleText: jdText,
					url: String(job.applyLink || job.jobLink || "").trim() || undefined,
					title: String(job.title || "").trim() || undefined,
				};
				const outcome = await recommendResumeForJob({
					pageContext,
					applierName,
					jobId,
				});
				await persistRecommendResumeResult(applierName, jobId, outcome.result, {
					requestId: outcome.requestId,
					usage: outcome.usage,
					mode: outcome.mode,
					provider: outcome.provider,
					requestedModel: outcome.requestedModel,
					billedModel: outcome.billedModel,
				});

				const stack =
					outcome.result?.matchedCatalogKey || outcome.result?.recommendedResume || null;
				return {
					jobId,
					ok: true,
					recommendedResumeStack: stack,
					recommendedResumeReason: outcome.result?.reason || null,
					warning: outcome.result?.warning || null,
					mode: outcome.mode || null,
					useCustomizedResume: Boolean(outcome.result?.useCustomizedResume),
				};
			} catch (err) {
				console.error(`[recommend-resumes] job ${jobId} failed`, err?.message || err);
				return {
					jobId,
					ok: false,
					error: err?.message || "Recommend failed",
					recommendedResumeStack: null,
					recommendedResumeReason: null,
					warning: null,
					mode: null,
				};
			}
		});

		const succeeded = results.filter((row) => row.ok).length;
		const failed = results.length - succeeded;
		return res.json({
			success: true,
			applierName,
			total: results.length,
			succeeded,
			failed,
			results,
		});
	} catch (err) {
		console.error("POST /api/jobs/recommend-resumes error", err);
		return res.status(500).json({
			success: false,
			error: err?.message || "Failed to recommend resumes",
		});
	}
}
