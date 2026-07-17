import { Router } from "express";
import {
  getAiUsage,
  getAiUsageSummary,
  getAiUsageMonitor,
} from "../controllers/aiUsageController.js";
import { requireAdmin } from "../middleware/requireAdmin.js";

const router = Router();

router.get("/ai-usage", requireAdmin, getAiUsage);
router.get("/ai-usage/summary", requireAdmin, getAiUsageSummary);
router.get("/ai-usage/monitor", requireAdmin, getAiUsageMonitor);

export default router;
