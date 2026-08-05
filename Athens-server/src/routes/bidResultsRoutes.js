import express from "express";
import {
	listBidResults,
	listRejectedBidResults,
	getBidResultStats,
	getBidResultEvents,
	getBidResultAiUsage,
	getBidRecordingUrl,
	updateBidResultStatus,
	markFixedBidResult,
} from "../controllers/bidResultsController.js";

const router = express.Router();

// Bid Management + shared read/review APIs.
// Write/upload paths for bidding live under /athens-lens/bids/* (Athens Lens).
router.get("/bid-results", listBidResults);
router.get("/bid-results/rejected", listRejectedBidResults);
router.get("/bid-results/stats", getBidResultStats);
router.get("/bid-results/recording-url", getBidRecordingUrl);
router.get("/bid-results/:id/events", getBidResultEvents);
router.get("/bid-results/:id/ai-usage", getBidResultAiUsage);
router.patch("/bid-results/:id", updateBidResultStatus);
router.post("/bid-results/mark-fixed", markFixedBidResult);

export default router;
