import express from "express";
import {
	listBidResults,
	listRejectedBidResults,
	getBidResultStats,
	getBidResultEvents,
	getBidResultAiUsage,
	updateBidResultStatus,
	markFixedBidResult,
	startBidResult,
	completeBidResult,
	skipBidResult,
	saveBidResultFlags,
	saveResumeAudit,
	downloadBidResumesZip,
	uploadBidRecording,
} from "../controllers/bidResultsController.js";

const router = express.Router();

// Static paths before :id
router.get("/bid-results", listBidResults);
router.get("/bid-results/rejected", listRejectedBidResults);
router.get("/bid-results/stats", getBidResultStats);
router.get("/bid-results/resumes.zip", downloadBidResumesZip);
router.post("/bid-results/resumes.zip", downloadBidResumesZip);
router.get("/bid-results/:id/events", getBidResultEvents);
router.get("/bid-results/:id/ai-usage", getBidResultAiUsage);
router.patch("/bid-results/:id", updateBidResultStatus);
router.post("/bid-results/mark-fixed", markFixedBidResult);
router.post("/bid-results/start", startBidResult);
router.post("/bid-results/complete", completeBidResult);
router.post("/bid-results/skip", skipBidResult);
router.post("/bid-results/flags", saveBidResultFlags);
router.post("/bid-results/resume-audit", saveResumeAudit);
router.post("/bid-recordings/upload", uploadBidRecording);

export default router;
