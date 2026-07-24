import { Router } from "express";
import {
	getFirebaseStatus,
	getFirebaseCollections,
	getFirebaseDocuments,
	getFirebaseDocument,
	getFirebaseStorage,
	getFirebaseStorageUrl,
	postFirebaseSearch,
} from "../controllers/firebaseExplorerController.js";
import { requireAdmin } from "../middleware/requireAdmin.js";

const router = Router();

router.get("/firebase/status", requireAdmin, getFirebaseStatus);
router.get("/firebase/collections", requireAdmin, getFirebaseCollections);
router.get("/firebase/documents", requireAdmin, getFirebaseDocuments);
router.get("/firebase/document", requireAdmin, getFirebaseDocument);
router.get("/firebase/storage", requireAdmin, getFirebaseStorage);
router.get("/firebase/storage/url", requireAdmin, getFirebaseStorageUrl);
router.post("/firebase/search", requireAdmin, postFirebaseSearch);

export default router;
