import express from "express";
import {
	postJobAnalyzePage,
	postJobAnalyzeFlags,
	postJobRecommendResume,
} from "../controllers/bidJobAnalyzeController.js";

const router = express.Router();

router.post("/job-analyze/page", postJobAnalyzePage);
router.post("/job-analyze/flags", postJobAnalyzeFlags);
router.post("/job-analyze/recommend-resume", postJobRecommendResume);

export default router;
