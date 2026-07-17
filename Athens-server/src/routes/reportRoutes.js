import express from "express";
import { getDailyApplications, getJobSources, getJobSourceSummary, getJobPostingFrequency, getJobApplicationFrequency } from "../controllers/reportController.js";

const router = express.Router();

router.get("/reports/daily-applications", getDailyApplications);
router.get("/reports/job-sources", getJobSources);
router.get("/reports/job-source-summary", getJobSourceSummary);
router.get("/reports/job-posting-frequency", getJobPostingFrequency);
router.get("/reports/job-application-frequency", getJobApplicationFrequency);

export default router;
