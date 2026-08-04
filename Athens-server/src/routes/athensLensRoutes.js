import express from "express";
import {
	listAthensLensJobsHandler,
	signInAthensLens,
	signOutAthensLens,
} from "../controllers/athensLensController.js";
import { requireAthensLensSession } from "../middleware/athensLensAuth.js";

const router = express.Router();

router.post("/athens-lens/auth/signin", signInAthensLens);
router.post("/athens-lens/auth/signout", requireAthensLensSession, signOutAthensLens);
router.get("/athens-lens/jobs", requireAthensLensSession, listAthensLensJobsHandler);

export default router;
