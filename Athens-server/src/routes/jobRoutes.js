import express from "express";
import {
	createJob,
	getJobs,
	getJobsV2,
	getJobStatusCounts,
	getJobStatusCountsV2,
	getCompanyGroupMembers,
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
	getJobViewerStatus,
	getJobSkillRadar,
} from "../controllers/jobController.js";
import {
	getSkillExtractStatus,
	startSkillExtract,
	stopSkillExtract,
} from "../controllers/jobSkillExtractController.js";
import {
	getTitleScanStatus,
	startTitleScan,
	stopTitleScan,
} from "../controllers/jobTitleScanController.js";

const router = express.Router();

router.post('/jobs', createJob);
router.post('/jobs/list', getJobs);
router.post('/jobs/list/v2', getJobsV2);
router.post('/jobs/list/v2/counts', getJobStatusCountsV2);
router.post('/jobs/list/counts', getJobStatusCounts);
router.post('/jobs/list/company-members', getCompanyGroupMembers);
router.get('/jobs/skill-extract/status', getSkillExtractStatus);
router.post('/jobs/skill-extract/start', startSkillExtract);
router.post('/jobs/skill-extract/stop', stopSkillExtract);
router.get('/jobs/title-scan/status', getTitleScanStatus);
router.post('/jobs/title-scan/start', startTitleScan);
router.post('/jobs/title-scan/stop', stopTitleScan);
router.get('/jobs/:id/viewer-status', getJobViewerStatus);
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
