import express from "express";
import {
	connectNotion,
	disconnectNotion,
	getNotionBlockChildren,
	getNotionCalendar,
	getNotionPage,
	getNotionStatus,
	queryNotionDataSource,
	searchNotionResources,
} from "../controllers/notionController.js";

const router = express.Router();

router.get("/integrations/notion/status", getNotionStatus);
router.post("/integrations/notion/connect", connectNotion);
router.delete("/integrations/notion", disconnectNotion);
router.get("/integrations/notion/search", searchNotionResources);
router.get("/integrations/notion/pages/:pageId", getNotionPage);
router.get("/integrations/notion/blocks/:blockId/children", getNotionBlockChildren);
router.post("/integrations/notion/data-sources/:dataSourceId/query", queryNotionDataSource);
router.get("/integrations/notion/calendar", getNotionCalendar);

export default router;
