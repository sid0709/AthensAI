import express from "express";
import {
	listAthensLensJobsHandler,
	signInAthensLens,
	signOutAthensLens,
	askAthensLensAi,
} from "../controllers/athensLensController.js";
import {
	beginAthensLensRecordingUpload,
	completeAthensLensBid,
	completeAthensLensRecordingUpload,
	saveAthensLensBidAnalysis,
	skipAthensLensBid,
	startAthensLensBid,
} from "../controllers/athensLensBidsController.js";
import { requireAthensLensSession } from "../middleware/athensLensAuth.js";
import {
	listAthensLensGmailMessageBodies,
	listAthensLensGmailMessages,
} from "../controllers/athensLensMailController.js";

const router = express.Router();

router.post("/athens-lens/auth/signin", signInAthensLens);
router.post("/athens-lens/auth/signout", requireAthensLensSession, signOutAthensLens);
router.get("/athens-lens/jobs", requireAthensLensSession, listAthensLensJobsHandler);
router.post("/athens-lens/ask-ai", requireAthensLensSession, askAthensLensAi);
router.post("/athens-lens/bids/start", requireAthensLensSession, startAthensLensBid);
router.post("/athens-lens/bids/complete", requireAthensLensSession, completeAthensLensBid);
router.post("/athens-lens/bids/skip", requireAthensLensSession, skipAthensLensBid);
router.post("/athens-lens/bids/analysis", requireAthensLensSession, saveAthensLensBidAnalysis);
router.post("/athens-lens/bids/recordings/uploads", requireAthensLensSession, beginAthensLensRecordingUpload);
router.post(
	"/athens-lens/bids/recordings/uploads/:uploadId/complete",
	requireAthensLensSession,
	completeAthensLensRecordingUpload,
);
router.get("/athens-lens/gmail/messages", requireAthensLensSession, listAthensLensGmailMessages);
router.get("/athens-lens/gmail/message-bodies", requireAthensLensSession, listAthensLensGmailMessageBodies);

export default router;
