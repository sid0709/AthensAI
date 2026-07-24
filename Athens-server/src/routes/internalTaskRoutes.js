import express from "express";
import { requireGoogleServiceIdentity } from "../middleware/googleServiceIdentity.js";
import { runJobAnalysisBatch } from "../services/jobAnalysis/index.js";
import { runMatchScoreBatch } from "../services/matching/matchScoreWorker.js";
import { processAlgoliaOutbox, rebuildAlgoliaJobs } from "../services/search/algoliaJobs.js";
import { requireWritesEnabled } from "../middleware/writeGate.js";

const router = express.Router();
router.use(requireGoogleServiceIdentity);
router.use(requireWritesEnabled);
router.post("/job-analysis", async (req, res, next) => {
	try { return res.json({ success: true, ...(await runJobAnalysisBatch(Number(req.body?.batchSize || 10))) }); }
	catch (error) { return next(error); }
});
router.post("/match-scores", async (_req, res, next) => {
	try { return res.json({ success: true, ...(await runMatchScoreBatch()) }); }
	catch (error) { return next(error); }
});
router.post("/search-outbox", async (req, res, next) => {
	try { return res.json({ success: true, ...(await processAlgoliaOutbox(Number(req.body?.batchSize || 100))) }); }
	catch (error) { return next(error); }
});
router.post("/search-rebuild", async (_req, res, next) => {
	try { return res.json({ success: true, ...(await rebuildAlgoliaJobs()) }); }
	catch (error) { return next(error); }
});
export default router;
