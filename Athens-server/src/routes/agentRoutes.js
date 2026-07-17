import express from "express";
import {
  getAgentActivity,
  getAgentDashboard,
  getAgentHealth,
  getAgentJobSources,
  getAgentModels,
  getAgentRuns,
  postAgentChat,
  postAgentDeploy,
} from "../controllers/agentController.js";
import {
  postApplyLog,
  getApplyRuns,
  getApplyRunById,
} from "../controllers/avalonLogController.js";

const router = express.Router();

router.get("/health", getAgentHealth);
router.get("/dashboard", getAgentDashboard);
router.get("/runs", getAgentRuns);
router.get("/activity", getAgentActivity);
router.get("/job-sources", getAgentJobSources);
router.get("/models", getAgentModels);
router.post("/chat", postAgentChat);
router.post("/deploy", postAgentDeploy);

// Avalon apply-run debug logging (local JSONL file + MongoDB history).
router.post("/apply-log", postApplyLog);
router.get("/apply-runs", getApplyRuns);
router.get("/apply-runs/:runId", getApplyRunById);

export default router;
