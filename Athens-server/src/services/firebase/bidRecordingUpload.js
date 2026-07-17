import { getStorageBucket } from "./firebaseAdmin.js";

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
