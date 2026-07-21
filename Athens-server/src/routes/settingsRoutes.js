import express from "express";
import {
	changePassword,
	deleteAccount,
	getNotificationPrefs,
	updateNotificationPrefs,
} from "../controllers/settingsController.js";

const router = express.Router();

router.get("/settings/notifications", getNotificationPrefs);
router.put("/settings/notifications", updateNotificationPrefs);
router.post("/auth/change-password", changePassword);
router.post("/auth/delete-account", deleteAccount);

export default router;
