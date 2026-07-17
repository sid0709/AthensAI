import express from "express";
import {
	postExternalScrapedJob,
	postCheckExternalScrapedJobExists,
} from "../controllers/scrapedJobIngestController.js";

const router = express.Router();

router.post("/expose/jobs/check", postCheckExternalScrapedJobExists);
router.post("/expose/jobs", postExternalScrapedJob);

export default router;
