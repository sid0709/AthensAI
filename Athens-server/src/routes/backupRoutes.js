import { Router } from "express";
import { requireAdmin } from "../middleware/requireAdmin.js";
import { downloadMongoBackup } from "../controllers/backupController.js";

const router = Router();

router.get("/admin/backup/mongodb.zip", requireAdmin, downloadMongoBackup);

export default router;
