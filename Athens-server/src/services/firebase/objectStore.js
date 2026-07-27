import { createHash } from "node:crypto";
import { DocumentId } from "@nextoffer/shared/document-id";
import { getStorageBucket } from "./firebaseAdmin.js";

const LOCAL_INLINE_LIMIT = 8 * 1024 * 1024;

function sha256(buffer) {
	return createHash("sha256").update(buffer).digest("hex");
}

export function storageSlug(value) {
	return (
		String(value || "unknown")
			.normalize("NFKD")
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 80) || "unknown"
	);
}

function requiresCloudStorage() {
	return process.env.NODE_ENV === "production" || Boolean(process.env.FIREBASE_STORAGE_BUCKET?.trim());
}

function gcsObjectFromDoc(doc) {
	const candidates = [
		doc?.file,
		doc?.object,
		doc?.bodyObject,
		doc?.contentBase64?.object,
		doc?.videoBase64?.object,
	];
	return candidates.find((value) => value?.storagePath) || null;
}

export async function putBinaryObject({ buffer, objectPath, mimeType, metadata = {} }) {
	if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error("Object content is empty");
	if (!objectPath) throw new Error("Cloud Storage object path is required");

	const digest = sha256(buffer);
	if (!requiresCloudStorage()) {
		if (buffer.length > LOCAL_INLINE_LIMIT) {
			throw new Error("FIREBASE_STORAGE_BUCKET is required for files larger than 8 MiB");
		}
		return {
			storage: "inline",
			contentBase64: buffer.toString("base64"),
			file: null,
		};
	}

	const bucket = getStorageBucket();
	const file = bucket.file(objectPath);
	let current = null;
	try {
		[current] = await file.getMetadata();
	} catch (error) {
		if (Number(error?.code) !== 404) throw error;
	}

	if (current && current.metadata?.sha256 === digest && Number(current.size) === buffer.length) {
		return {
			storage: "gcs",
			contentBase64: null,
			file: {
				storagePath: objectPath,
				generation: String(current.generation || ""),
				mimeType: current.contentType || mimeType || "application/octet-stream",
				byteCount: buffer.length,
				sha256: digest,
			},
		};
	}

	await file.save(buffer, {
		resumable: buffer.length >= 5 * 1024 * 1024,
		validation: "crc32c",
		metadata: {
			contentType: mimeType || "application/octet-stream",
			cacheControl: "private, max-age=0, no-store",
			metadata: {
				sha256: digest,
				...Object.fromEntries(Object.entries(metadata).map(([key, value]) => [key, String(value)])),
			},
		},
	});
	const [saved] = await file.getMetadata();
	return {
		storage: "gcs",
		contentBase64: null,
		file: {
			storagePath: objectPath,
			generation: String(saved.generation || ""),
			mimeType: saved.contentType || mimeType || "application/octet-stream",
			byteCount: buffer.length,
			sha256: digest,
		},
	};
}

export async function readStoredObject(doc) {
	const object = gcsObjectFromDoc(doc);
	if (object) {
		const bucket = getStorageBucket();
		const file = bucket.file(object.storagePath, object.generation ? { generation: object.generation } : undefined);
		const [buffer] = await file.download({ validation: "crc32c" });
		if (object.byteCount != null && Number(object.byteCount) !== buffer.length) {
			throw new Error(`Cloud Storage byte count mismatch for ${object.storagePath}`);
		}
		if (object.sha256 && sha256(buffer) !== object.sha256) {
			throw new Error(`Cloud Storage SHA-256 mismatch for ${object.storagePath}`);
		}
		return buffer;
	}

	if (typeof doc?.contentBase64 === "string" && doc.contentBase64) {
		return Buffer.from(doc.contentBase64, "base64");
	}

	return null;
}

export async function deleteStoredObject(doc) {
	const object = gcsObjectFromDoc(doc);
	if (object) {
		const bucket = getStorageBucket();
		await bucket.file(object.storagePath, object.generation ? { generation: object.generation } : undefined).delete({ ignoreNotFound: true });
		return "gcs";
	}

	return null;
}

export function firestoreDocumentBytes(value) {
	return Buffer.byteLength(JSON.stringify(value, (_key, child) => {
		if (child instanceof DocumentId) return child.toHexString();
		if (child instanceof Date) return child.toISOString();
		if (Buffer.isBuffer(child)) return { byteCount: child.length };
		return child;
	}), "utf8");
}

export function assertFirestoreDocumentSize(value, context = "document") {
	const bytes = firestoreDocumentBytes(value);
	const max = 900 * 1024;
	if (bytes > max) {
		const error = new Error(`${context} is ${bytes} bytes; binary or oversized fields must be stored in Cloud Storage (maximum ${max})`);
		error.code = "FIRESTORE_DOCUMENT_TOO_LARGE";
		error.byteCount = bytes;
		throw error;
	}
	return bytes;
}
