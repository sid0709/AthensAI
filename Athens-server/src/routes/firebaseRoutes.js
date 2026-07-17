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

const router = Router();

router.get("/firebase/status", getFirebaseStatus);
router.get("/firebase/collections", getFirebaseCollections);
router.get("/firebase/documents", getFirebaseDocuments);
router.get("/firebase/document", getFirebaseDocument);
router.get("/firebase/storage", getFirebaseStorage);
router.get("/firebase/storage/url", getFirebaseStorageUrl);
router.post("/firebase/search", postFirebaseSearch);

export default router;
