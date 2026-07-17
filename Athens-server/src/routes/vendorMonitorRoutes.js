import express from "express";
import {
	listVendorTasks,
	addVendorTasks,
	updateVendorTask,
	deleteVendorTask,
	clearVendorTasks,
	getVendorTasksAnalytics,
} from "../controllers/vendorTaskController.js";

const router = express.Router();

router.get("/vendor/tasks/analytics", getVendorTasksAnalytics);
router.get("/vendor/tasks", listVendorTasks);
router.post("/vendor/tasks", addVendorTasks);
router.patch("/vendor/tasks/:taskId", updateVendorTask);
router.delete("/vendor/tasks/:taskId", deleteVendorTask);
router.delete("/vendor/tasks", clearVendorTasks);

export default router;
