import express from "express";
import {
	createJob,
	getJobs,
	getJobStatusCounts,
	applyToJob,
	removeJobs,
	updateJobStatus,
	unapplyFromJob,
	updateJobBidStatus,
	getJobsForRule,
	removeJobsForRule,
	analyzeJob,
	getJobSkillAnalysis,
	getJobById,
	getJobSkillRadar,
} from "../controllers/jobController.js";
import {
	getSkillExtractStatus,
	startSkillExtract,
	stopSkillExtract,
} from "../controllers/jobSkillExtractController.js";

const router = express.Router();

router.post('/jobs', createJob);
router.post('/jobs/list', getJobs);
router.post('/jobs/list/counts', getJobStatusCounts);
router.get('/jobs/skill-extract/status', getSkillExtractStatus);
router.post('/jobs/skill-extract/start', startSkillExtract);
router.post('/jobs/skill-extract/stop', stopSkillExtract);
router.get('/jobs/:id', getJobById);
router.get('/jobs/:id/skill-radar', getJobSkillRadar);
router.post('/jobs/:id/analyze', analyzeJob);
router.get('/jobs/:id/skill-analysis', getJobSkillAnalysis);
router.get('/jobs/rule/:name', getJobsForRule);
router.delete('/jobs/rule/:name', removeJobsForRule);
router.post('/jobs/remove', removeJobs);
router.post('/jobs/:id/apply', applyToJob);
router.post('/jobs/:id/status', updateJobStatus);
router.post('/jobs/:id/unapply', unapplyFromJob);
router.post('/jobs/:id/bid-status', updateJobBidStatus);

export default router;
