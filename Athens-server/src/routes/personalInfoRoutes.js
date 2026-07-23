
import express from "express";
import {
	getProfileMatchSkills,
	addProfileMatchSkill,
	removeProfileMatchSkill,
} from "../controllers/profileMatchSkillsController.js";
import {
	getSkillDictionary,
	getSkillCoverage,
} from "../controllers/skillDictionaryController.js";
import {
	getSkills,
	addSkill,
	deleteSkill,
	updateSkills,
	getAutoBidProfile,
	upsertAutoBidProfile,
	setDefaultModel,
	getResumeCatalog,
	upsertResumeCatalog,
	validateResumeCatalogHandler,
} from "../controllers/personalInfoController.js";
import {
	getLlmModels,
  generateResume,
  generateResumeStream,
  generateResumeForAgentJob,
  generateResumeForAgentJobStream,
  getAgentJobResumePdf,
  getAgentJobResumesStatus,
  deleteAgentJobResumesHandler,
  getGeneratorConfig,
	saveGeneratorConfig,
  listGenerations,
  getGeneration,
  renderGenerationPdf,
  deleteGeneration,
  refreshGeneratedResumesIdentityHandler,
  refreshGeneratedResumesIdentityStreamHandler,
  checkLlmKey,
} from "../controllers/resumeGenController.js";
import { renderResumePdf } from "../controllers/resumePdfController.js";
import { renderResumeDocx } from "../controllers/resumeDocxController.js";
import {
	listUserResumesHandler,
	getUserResumeHandler,
	createUserResumeHandler,
	bulkCreateUserResumesHandler,
	setPrimaryUserResumeHandler,
	deleteUserResumeHandler,
	analyzeUserResumeHandler,
	listUserGraphsHandler,
	clearUserResumeAnalysisHandler,
	getSubmissionKitResumeHandler,
} from "../controllers/userResumeController.js";
import {
	listResumeTemplatesHandler,
	getResumeTemplateHandler,
	createResumeTemplateHandler,
	deleteResumeTemplateHandler,
	fillResumeTemplateHandler,
	previewResumeTemplateHandler,
	previewResumeTemplateImagesHandler,
} from "../controllers/resumeTemplateController.js";
import { analyzeResumeMatch } from "../controllers/resumeAnalysisController.js";
import { listChromeProfiles, importChromeSession, chromeProfileAvatar } from "../controllers/chromeProfilesController.js";

const router = express.Router();

router.get('/personal/profile-match-skills', getProfileMatchSkills);
router.post('/personal/profile-match-skills', addProfileMatchSkill);
router.delete('/personal/profile-match-skills', removeProfileMatchSkill);

router.get('/personal/skill-dictionary', getSkillDictionary);
router.get('/personal/skill-dictionary/coverage', getSkillCoverage);

router.get('/personal/skills', getSkills);
router.post('/personal/skills', addSkill);
router.delete('/personal/skills', deleteSkill);
router.post('/personal/skills/update', updateSkills);

router.get('/personal/auto-bid-profile', getAutoBidProfile);
router.put('/personal/auto-bid-profile', upsertAutoBidProfile);
router.post('/personal/default-model', setDefaultModel);

router.get('/personal/resume-catalog', getResumeCatalog);
router.put('/personal/resume-catalog', upsertResumeCatalog);
router.post('/personal/resume-catalog/validate', validateResumeCatalogHandler);

router.get('/personal/llm-models', getLlmModels);
router.post('/personal/resume-generate', generateResume);
router.post('/personal/resume-generate/stream', generateResumeStream);
router.post('/personal/resume-generate/for-agent-job', generateResumeForAgentJob);
router.post('/personal/resume-generate/for-agent-job/stream', generateResumeForAgentJobStream);
router.get('/personal/agent-job-resume/:jobId/pdf', getAgentJobResumePdf);
router.post('/personal/agent-job-resumes/status', getAgentJobResumesStatus);
router.post('/personal/agent-job-resumes/delete', deleteAgentJobResumesHandler);
router.get('/personal/resume-generator/config', getGeneratorConfig);
router.put('/personal/resume-generator/config', saveGeneratorConfig);
router.get('/personal/resume-generations', listGenerations);
router.post('/personal/resume-generations/refresh-identity', refreshGeneratedResumesIdentityHandler);
router.post('/personal/resume-generations/refresh-identity/stream', refreshGeneratedResumesIdentityStreamHandler);
router.get('/personal/resume-generations/:id', getGeneration);
router.get('/personal/resume-generations/:id/pdf', renderGenerationPdf);
router.delete('/personal/resume-generations/:id', deleteGeneration);
router.post('/personal/llm-key-check', checkLlmKey);
router.post('/personal/resume-pdf', renderResumePdf);
router.post('/personal/resume-docx', renderResumeDocx);

router.get('/personal/resume-templates', listResumeTemplatesHandler);
router.get('/personal/resume-templates/:id', getResumeTemplateHandler);
router.post('/personal/resume-templates', createResumeTemplateHandler);
router.delete('/personal/resume-templates/:id', deleteResumeTemplateHandler);
router.post('/personal/resume-template-fill', fillResumeTemplateHandler);
router.post('/personal/resume-template-preview', previewResumeTemplateHandler);
router.post('/personal/resume-template-preview-images', previewResumeTemplateImagesHandler);

router.get('/user-graph', listUserGraphsHandler);

router.get('/personal/submission-kit-resume', getSubmissionKitResumeHandler);
router.get('/personal/user-resumes', listUserResumesHandler);
router.get('/personal/user-resumes/:id', getUserResumeHandler);
router.post('/personal/user-resumes', createUserResumeHandler);
router.post('/personal/user-resumes/bulk', bulkCreateUserResumesHandler);
router.put('/personal/user-resumes/:id/primary', setPrimaryUserResumeHandler);
router.post('/personal/user-resumes/:id/analyze', analyzeUserResumeHandler);
router.post('/personal/user-resumes/:id/clear-analysis', clearUserResumeAnalysisHandler);
router.delete('/personal/user-resumes/:id', deleteUserResumeHandler);
router.post('/personal/resume-analysis', analyzeResumeMatch);
router.get('/personal/chrome-profiles', listChromeProfiles);
router.post('/personal/chrome-profiles/import', importChromeSession);
router.get('/personal/chrome-profiles/avatar', chromeProfileAvatar);

export default router;
