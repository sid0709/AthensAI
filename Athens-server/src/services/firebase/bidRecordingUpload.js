import { getStorageBucket } from "./firebaseAdmin.js";
import { getFirestoreDb } from "./firebaseAdmin.js";
import { createHash, randomUUID } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";

function slugify(value) {
	return String(value || "unknown")
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 64) || "unknown";
}

function extFromContentType(contentType, fileName = "") {
	const name = String(fileName || "").toLowerCase();
	if (name.endsWith(".mp4")) return "mp4";
	if (name.endsWith(".webm")) return "webm";
	const ct = String(contentType || "").toLowerCase();
	if (ct.includes("mp4")) return "mp4";
	return "webm";
}

/**
 * Upload a bid recording buffer to Firebase Storage under bid-recordings/.
 */
export async function uploadBidRecordingObject({
	applierName,
	sessionId,
	buffer,
	contentType = "video/webm",
	fileName = "",
}) {
	const bucket = getStorageBucket();
	const ext = extFromContentType(contentType, fileName);
	const safeSession = slugify(sessionId || `sess-${Date.now()}`);
	const safeApplier = slugify(applierName);
	const stamp = Date.now();
	const storagePath = `bid-recordings/${safeApplier}/${safeSession}/rec-${stamp}.${ext}`;
	const file = bucket.file(storagePath);

	await file.save(buffer, {
		contentType: contentType || (ext === "mp4" ? "video/mp4" : "video/webm"),
		metadata: {
			metadata: {
				applierName: String(applierName || ""),
				sessionId: String(sessionId || ""),
				uploadedAt: new Date().toISOString(),
			},
		},
		resumable: false,
	});

	const [metadata] = await file.getMetadata();
	return {
		storagePath,
		contentType: metadata.contentType || contentType || "video/webm",
		sizeBytes: Number(metadata.size || buffer.length || 0),
		bucket: bucket.name,
	};
}

const MAX_RECORDING_BYTES = Number(process.env.MAX_RECORDING_BYTES || 8 * 1024 * 1024 * 1024);

export async function beginBidRecordingResumableUpload({
	applierName,
	jobId,
	sessionId,
	contentType = "video/webm",
	fileName = "session.webm",
	expectedBytes,
	expectedSha256,
	uid,
}) {
	const byteCount = Number(expectedBytes);
	if (!Number.isSafeInteger(byteCount) || byteCount <= 0 || byteCount > MAX_RECORDING_BYTES) {
		throw new Error(`Recording size must be between 1 and ${MAX_RECORDING_BYTES} bytes`);
	}
	const sha256 = String(expectedSha256 || "").trim().toLowerCase();
	if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error("A valid SHA-256 is required");

	const uploadId = randomUUID();
	const ext = extFromContentType(contentType, fileName);
	const storagePath = `bid-recordings/${slugify(applierName)}/${slugify(sessionId)}/${uploadId}.${ext}`;
	const bucket = getStorageBucket();
	const file = bucket.file(storagePath);
	const [uploadUrl] = await file.createResumableUpload({
		origin: process.env.UPLOAD_CORS_ORIGIN?.trim() || undefined,
		metadata: {
			contentType,
			metadata: {
				uploadId,
				uid: String(uid || ""),
				applierName,
				jobId,
				sessionId,
				expectedSha256: sha256,
			},
		},
	});

	await getFirestoreDb().collection("upload_sessions").doc(uploadId).set({
		uploadId,
		uid: String(uid || ""),
		applierName,
		jobId,
		sessionId,
		storagePath,
		contentType,
		expectedBytes: byteCount,
		expectedSha256: sha256,
		status: "pending",
		createdAt: FieldValue.serverTimestamp(),
		expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
	});

	return { uploadId, uploadUrl, storagePath, bucket: bucket.name };
}

async function sha256File(file) {
	const hash = createHash("sha256");
	let bytes = 0;
	await new Promise((resolve, reject) => {
		file.createReadStream()
			.on("data", (chunk) => {
				bytes += chunk.length;
				hash.update(chunk);
			})
			.on("error", reject)
			.on("end", resolve);
	});
	return { sha256: hash.digest("hex"), bytes };
}

export async function completeBidRecordingResumableUpload({ uploadId, uid }) {
	const ref = getFirestoreDb().collection("upload_sessions").doc(String(uploadId));
	const sessionSnap = await ref.get();
	if (!sessionSnap.exists) throw new Error("Upload session was not found");
	const session = sessionSnap.data();
	if (session.uid && String(session.uid) !== String(uid || "")) throw new Error("Upload session owner mismatch");
	if (session.status === "completed") return session;
	if (session.expiresAt?.toDate?.().getTime() < Date.now()) throw new Error("Upload session expired");

	const bucket = getStorageBucket();
	const file = bucket.file(session.storagePath);
	const [exists] = await file.exists();
	if (!exists) throw new Error("Storage object is not complete");
	const [metadata] = await file.getMetadata();
	const actual = await sha256File(file);
	if (actual.bytes !== Number(session.expectedBytes) || actual.sha256 !== session.expectedSha256) {
		await file.delete({ ignoreNotFound: true });
		await ref.update({
			status: "rejected",
			actualBytes: actual.bytes,
			actualSha256: actual.sha256,
			validatedAt: FieldValue.serverTimestamp(),
		});
		throw new Error("Uploaded recording failed byte-count or SHA-256 validation");
	}

	const completed = {
		...session,
		status: "completed",
		actualBytes: actual.bytes,
		actualSha256: actual.sha256,
		contentType: metadata.contentType || session.contentType,
		generation: String(metadata.generation || ""),
		completedAt: new Date(),
	};
	await ref.set({
		status: "completed",
		actualBytes: actual.bytes,
		actualSha256: actual.sha256,
		generation: completed.generation,
		completedAt: FieldValue.serverTimestamp(),
	}, { merge: true });
	return completed;
}
