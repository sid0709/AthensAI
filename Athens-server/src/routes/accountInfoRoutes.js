import express from "express";
import {
	getAccountInfo,
	getAccountInfoByName,
	addAccountInfo,
	removeAccountInfo,
	signup,
	signin,
	bidderSignin,
	setVendorPassword,
	getAuthSession,
} from "../controllers/accountInfoController.js";
import { requireAdmin } from "../middleware/requireAdmin.js";

const router = express.Router();
const legacyAuth = (req, res, next) => {
	const firebaseRequired = !["0", "false", "no", "off"].includes(
		String(process.env.FIREBASE_AUTH_REQUIRED ?? "").trim().toLowerCase(),
	);
	if (process.env.NODE_ENV === "production" && firebaseRequired) {
		return res.status(410).json({ success: false, message: "Legacy password authentication is disabled; use Firebase Auth." });
	}
	return next();
};

router.get("/account_info", getAccountInfo);
router.get("/account_info/by/:name", getAccountInfoByName);
router.post("/account_info", requireAdmin, addAccountInfo);
router.delete("/account_info/:name", requireAdmin, removeAccountInfo);

// Auth routes
router.get("/auth/session", getAuthSession);
router.post("/auth/signup", legacyAuth, signup);
router.post("/auth/signin", legacyAuth, signin);
router.post("/auth/bidder-signin", legacyAuth, bidderSignin);
router.post("/auth/vendor-password", legacyAuth, setVendorPassword);

export default router;
