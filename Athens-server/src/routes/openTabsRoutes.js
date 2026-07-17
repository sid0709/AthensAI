
import express from "express";
import { openTabs } from "../controllers/openTabsController.js";

const router = express.Router();

router.post('/open-tabs', openTabs);

export default router;
