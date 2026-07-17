import { createAsyncHandler, apiError, apiOk } from "../utils/http.js";
import {
	fetchFirebaseStatus,
	listCollections,
	listDocuments,
	getDocument,
	listStorage,
	getSignedStorageUrl,
	searchDocuments,
} from "../services/firebase/firebaseExplorer.js";

export const getFirebaseStatus = createAsyncHandler(async (_req, res) => {
	const status = await fetchFirebaseStatus();
	return apiOk(res, { status });
});

export const getFirebaseCollections = createAsyncHandler(async (req, res) => {
	const parentPath = typeof req.query.parent === "string" ? req.query.parent : "";
	try {
		const data = await listCollections(parentPath);
		return apiOk(res, data);
	} catch (err) {
		return apiError(res, 400, err instanceof Error ? err.message : String(err));
	}
});

export const getFirebaseDocuments = createAsyncHandler(async (req, res) => {
	const path = typeof req.query.path === "string" ? req.query.path : "";
	if (!path) return apiError(res, 400, "path is required");
	try {
		const data = await listDocuments({
			path,
			limit: req.query.limit,
			cursor: typeof req.query.cursor === "string" ? req.query.cursor : undefined,
			orderField: typeof req.query.orderField === "string" ? req.query.orderField : undefined,
		});
		return apiOk(res, data);
	} catch (err) {
		return apiError(res, 400, err instanceof Error ? err.message : String(err));
	}
});

export const getFirebaseDocument = createAsyncHandler(async (req, res) => {
	const path = typeof req.query.path === "string" ? req.query.path : "";
	if (!path) return apiError(res, 400, "path is required");
	try {
		const data = await getDocument(path);
		if (!data.exists) return apiError(res, 404, "Document not found");
		return apiOk(res, data);
	} catch (err) {
		return apiError(res, 400, err instanceof Error ? err.message : String(err));
	}
});

export const getFirebaseStorage = createAsyncHandler(async (req, res) => {
	try {
		const data = await listStorage({
			prefix: typeof req.query.prefix === "string" ? req.query.prefix : "",
			pageToken: typeof req.query.pageToken === "string" ? req.query.pageToken : undefined,
			maxResults: req.query.limit,
		});
		return apiOk(res, data);
	} catch (err) {
		return apiError(res, 400, err instanceof Error ? err.message : String(err));
	}
});

export const getFirebaseStorageUrl = createAsyncHandler(async (req, res) => {
	const path = typeof req.query.path === "string" ? req.query.path : "";
	if (!path) return apiError(res, 400, "path is required");
	try {
		const data = await getSignedStorageUrl(path);
		return apiOk(res, data);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		const status = message === "File not found" ? 404 : 400;
		return apiError(res, status, message);
	}
});

export const postFirebaseSearch = createAsyncHandler(async (req, res) => {
	const body = req.body || {};
	try {
		const data = await searchDocuments({
			path: body.path,
			field: body.field,
			op: body.op || "==",
			value: body.value,
			limit: body.limit,
		});
		return apiOk(res, data);
	} catch (err) {
		return apiError(res, 400, err instanceof Error ? err.message : String(err));
	}
});
