import express from "express";
import {
	getAccountInfo,
	getAccountInfoByName,
	addAccountInfo,
	removeAccountInfo,
	signup,
	signin,
	setVendorPassword,
	getAuthSession,
} from "../controllers/accountInfoController.js";
import { requireAdmin } from "../middleware/requireAdmin.js";

const router = express.Router();

router.get("/account_info", getAccountInfo);
router.get("/account_info/by/:name", getAccountInfoByName);
router.post("/account_info", requireAdmin, addAccountInfo);
router.delete("/account_info/:name", requireAdmin, removeAccountInfo);

// Auth routes
router.get("/auth/session", getAuthSession);
router.post("/auth/signup", signup);
router.post("/auth/signin", signin);
router.post("/auth/vendor-password", setVendorPassword);

export default router;
