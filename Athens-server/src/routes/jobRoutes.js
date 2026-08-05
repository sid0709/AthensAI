import express from "express";
import {
	createJob,
	createJobsBulk,
	getJobsV3,
	getJobStatusCountsV3,
	applyToJob,
	removeJobs,
	removeOtherCompanyJobs,
	updateJobStatus,
	unapplyFromJob,
	updateJobBidStatus,
	updateJobsBidStatusBulk,
	getJobsForRule,
	removeJobsForRule,
	analyzeJob,
	getJobSkillAnalysis,
	getJobById,
	getJobViewerStatus,
	getJobSkillRadar,
} from "../controllers/jobController.js";
import { recommendResumesBulk } from "../controllers/recommendResumeController.js";
import {
	getSkillExtractStatus,
	startSkillExtract,
	stopSkillExtract,
} from "../controllers/jobSkillExtractController.js";
import {
	approveTitleReviewJobs,
	getTitleReviewBootstrap,
	getTitleReviewStatus,
	listTitleReviewJobs,
	removeTitleReviewJobs,
	startTitleReview,
	stopTitleReview,
} from "../controllers/jobTitleReviewController.js";

const router = express.Router();

router.post('/jobs', createJob);
router.post('/jobs/bulk', createJobsBulk);
router.post('/jobs/list', getJobsV3);
router.post('/jobs/list/v3', getJobsV3);
router.post('/jobs/list/v3/counts', getJobStatusCountsV3);
router.post('/jobs/list/counts', getJobStatusCountsV3);
router.post('/jobs/recommend-resumes', recommendResumesBulk);
router.get('/jobs/skill-extract/status', getSkillExtractStatus);
router.post('/jobs/skill-extract/start', startSkillExtract);
router.post('/jobs/skill-extract/stop', stopSkillExtract);
router.get('/jobs/title-review/status', getTitleReviewStatus);
router.post('/jobs/title-review/start', startTitleReview);
router.post('/jobs/title-review/stop', stopTitleReview);
router.get('/jobs/title-review/bootstrap', getTitleReviewBootstrap);
router.get('/jobs/title-review', listTitleReviewJobs);
router.post('/jobs/title-review/approve', approveTitleReviewJobs);
router.post('/jobs/title-review/remove', removeTitleReviewJobs);
router.get('/jobs/:id/viewer-status', getJobViewerStatus);
router.get('/jobs/:id', getJobById);
router.get('/jobs/:id/skill-radar', getJobSkillRadar);
router.post('/jobs/:id/analyze', analyzeJob);
router.get('/jobs/:id/skill-analysis', getJobSkillAnalysis);
router.get('/jobs/rule/:name', getJobsForRule);
router.delete('/jobs/rule/:name', removeJobsForRule);
router.post('/jobs/remove', removeJobs);
router.post('/jobs/company/remove-others', removeOtherCompanyJobs);
router.post('/jobs/bid-status/bulk', updateJobsBidStatusBulk);
router.post('/jobs/:id/apply', applyToJob);
router.post('/jobs/:id/status', updateJobStatus);
router.post('/jobs/:id/unapply', unapplyFromJob);
router.post('/jobs/:id/bid-status', updateJobBidStatus);

export default router;
