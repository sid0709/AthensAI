import { getFirestoreDb, getStorageBucket, getFirebaseMeta } from "./firebaseAdmin.js";
import { parseFirestorePath, serializeDocument, serializeFirestoreValue } from "./serialize.js";

function clampLimit(value, fallback = 50, max = 200) {
	const n = Number(value);
	if (!Number.isFinite(n)) return fallback;
	return Math.min(max, Math.max(1, Math.floor(n)));
}

export async function fetchFirebaseStatus() {
	const meta = getFirebaseMeta();
	let firestoreOk = false;
	let storageOk = false;
	let collectionCount = null;
	let firestoreError = null;
	let storageError = null;

	try {
		const db = getFirestoreDb();
		const collections = await db.listCollections();
		firestoreOk = true;
		collectionCount = collections.length;
	} catch (err) {
		firestoreError = err instanceof Error ? err.message : String(err);
	}

	try {
		const bucket = getStorageBucket();
		await bucket.getMetadata();
		storageOk = true;
	} catch (err) {
		storageError = err instanceof Error ? err.message : String(err);
	}

	return {
		ok: firestoreOk || storageOk,
		firestoreOk,
		storageOk,
		...meta,
		collectionCount,
		firestoreError,
		storageError,
		error: firestoreError || storageError || null,
	};
}

export async function listCollections(parentPath = "") {
	const db = getFirestoreDb();
	const parsed = parseFirestorePath(parentPath);

	let refs;
	if (!parsed.path) {
		refs = await db.listCollections();
	} else if (parsed.isDocument) {
		refs = await db.doc(parsed.path).listCollections();
	} else {
		throw new Error("Parent path must be empty (root) or a document path");
	}

	const collections = await Promise.all(
		refs.map(async (ref) => {
			let documentCount = null;
			try {
				const agg = await ref.count().get();
				documentCount = agg.data().count;
			} catch {
				documentCount = null;
			}
			return {
				id: ref.id,
				path: ref.path,
				documentCount,
			};
		}),
	);

	collections.sort((a, b) => a.id.localeCompare(b.id));
	return { parentPath: parsed.path || null, collections };
}

export async function listDocuments({ path, limit, cursor, orderField }) {
	const db = getFirestoreDb();
	const parsed = parseFirestorePath(path);
	if (!parsed.isCollection) {
		throw new Error("Path must point to a collection (odd number of segments)");
	}

	const pageSize = clampLimit(limit, 50, 200);
	let query = db.collection(parsed.path);

	const field = typeof orderField === "string" && orderField.trim() ? orderField.trim() : null;
	if (field) {
		query = query.orderBy(field);
	} else {
		query = query.orderBy("__name__");
	}

	if (cursor) {
		const cursorDoc = await db.doc(`${parsed.path}/${cursor}`).get();
		if (cursorDoc.exists) {
			query = query.startAfter(cursorDoc);
		}
	}

	const snap = await query.limit(pageSize + 1).get();
	const docs = snap.docs.slice(0, pageSize).map(serializeDocument);
	const hasMore = snap.docs.length > pageSize;
	const nextCursor = hasMore ? snap.docs[pageSize - 1]?.id || null : null;

	return {
		path: parsed.path,
		documents: docs,
		count: docs.length,
		hasMore,
		nextCursor,
		limit: pageSize,
	};
}

export async function getDocument(path) {
	const db = getFirestoreDb();
	const parsed = parseFirestorePath(path);
	if (!parsed.isDocument) {
		throw new Error("Path must point to a document (even number of segments)");
	}

	const snap = await db.doc(parsed.path).get();
	if (!snap.exists) {
		return { exists: false, path: parsed.path, document: null, subcollections: [] };
	}

	const subRefs = await snap.ref.listCollections();
	const subcollections = subRefs
		.map((ref) => ({ id: ref.id, path: ref.path }))
		.sort((a, b) => a.id.localeCompare(b.id));

	return {
		exists: true,
		path: parsed.path,
		document: serializeDocument(snap),
		subcollections,
	};
}

export async function listStorage({ prefix = "", pageToken, maxResults }) {
	const bucket = getStorageBucket();
	const pageSize = clampLimit(maxResults, 100, 500);
	const normalizedPrefix = String(prefix || "").replace(/^\/+/, "");

	const [files, , apiResponse] = await bucket.getFiles({
		prefix: normalizedPrefix || undefined,
		maxResults: pageSize,
		pageToken: pageToken || undefined,
		autoPaginate: false,
		delimiter: "/",
	});

	const prefixes = Array.isArray(apiResponse?.prefixes) ? apiResponse.prefixes : [];
	const nextPageToken = apiResponse?.nextPageToken || null;

	return {
		bucket: bucket.name,
		prefix: normalizedPrefix,
		folders: prefixes.map((p) => ({
			name: p.replace(/\/$/, "").split("/").pop() || p,
			prefix: p,
		})),
		files: files.map((file) => ({
			name: file.name.split("/").pop() || file.name,
			fullPath: file.name,
			size: Number(file.metadata?.size || 0),
			contentType: file.metadata?.contentType || null,
			updated: file.metadata?.updated || null,
			timeCreated: file.metadata?.timeCreated || null,
		})),
		nextPageToken,
	};
}

export async function getSignedStorageUrl(objectPath, expiresMs = 60 * 60 * 1000) {
	const bucket = getStorageBucket();
	const normalized = String(objectPath || "").replace(/^\/+/, "");
	if (!normalized) throw new Error("path is required");

	const file = bucket.file(normalized);
	const [exists] = await file.exists();
	if (!exists) throw new Error("File not found");

	const [metadata] = await file.getMetadata();
	const [url] = await file.getSignedUrl({
		action: "read",
		expires: Date.now() + expiresMs,
		version: "v4",
	});

	return {
		bucket: bucket.name,
		path: normalized,
		url,
		expiresInMs: expiresMs,
		contentType: metadata.contentType || null,
		size: Number(metadata.size || 0),
		name: normalized.split("/").pop() || normalized,
	};
}

export async function searchDocuments({ path, field, op = "==", value, limit }) {
	const db = getFirestoreDb();
	const parsed = parseFirestorePath(path);
	if (!parsed.isCollection) {
		throw new Error("Path must point to a collection");
	}
	if (!field) throw new Error("field is required");

	const pageSize = clampLimit(limit, 50, 200);
	let parsedValue = value;
	if (typeof value === "string") {
		try {
			parsedValue = JSON.parse(value);
		} catch {
			parsedValue = value;
		}
	}

	const allowed = new Set(["==", "!=", "<", "<=", ">", ">=", "array-contains"]);
	if (!allowed.has(op)) throw new Error(`Unsupported operator: ${op}`);

	const snap = await db.collection(parsed.path).where(field, op, parsedValue).limit(pageSize).get();
	return {
		path: parsed.path,
		documents: snap.docs.map(serializeDocument),
		count: snap.size,
	};
}

export { serializeFirestoreValue };
