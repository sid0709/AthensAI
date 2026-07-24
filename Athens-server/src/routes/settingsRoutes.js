import express from "express";
import {
	changePassword,
	deleteAccount,
	getNotificationPrefs,
	updateNotificationPrefs,
} from "../controllers/settingsController.js";

const router = express.Router();
const legacyPasswordRoute = (req, res, next) => {
	if (process.env.NODE_ENV === "production") return res.status(410).json({ success: false, message: "Passwords are managed by Firebase Auth." });
	return next();
};

router.get("/settings/notifications", getNotificationPrefs);
router.put("/settings/notifications", updateNotificationPrefs);
router.post("/auth/change-password", legacyPasswordRoute, changePassword);
router.post("/auth/delete-account", deleteAccount);

export default router;
