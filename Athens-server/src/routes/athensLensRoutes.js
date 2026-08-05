import express from "express";
import {
	listAthensLensJobsHandler,
	signInAthensLens,
	signOutAthensLens,
	askAthensLensAi,
} from "../controllers/athensLensController.js";
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
router.get("/athens-lens/gmail/messages", requireAthensLensSession, listAthensLensGmailMessages);
router.get("/athens-lens/gmail/message-bodies", requireAthensLensSession, listAthensLensGmailMessageBodies);

export default router;
