import { getBidReviewEventsCollection } from "../db/mongo.js";

/**
 * Append-only bid review / lifecycle events for Athens Bid Management timeline.
 * @param {object} event
 */
export async function appendBidReviewEvent(event) {
	const collection = getBidReviewEventsCollection();
	if (!collection) return null;

	const now = new Date();
	const doc = {
		taskId: event.taskId != null ? String(event.taskId) : null,
		jobId: event.jobId != null ? String(event.jobId) : null,
		applierName: String(event.applierName || "").trim() || null,
		eventType: String(event.eventType || "").trim(),
		fromStatus: event.fromStatus ?? null,
		toStatus: event.toStatus ?? null,
		actorType: event.actorType || "system",
		actorName: event.actorName || null,
		rejectReason: event.rejectReason ?? null,
		rejectSource: event.rejectSource ?? null,
		meta: event.meta && typeof event.meta === "object" ? event.meta : null,
		createdAt: now,
	};
	if (!doc.eventType || !doc.applierName) return null;

	const result = await collection.insertOne(doc);
	return { ...doc, _id: result.insertedId };
}

export function serializeBidReviewEvent(doc) {
	if (!doc) return null;
	return {
		id: String(doc._id),
		taskId: doc.taskId ?? null,
		jobId: doc.jobId ?? null,
		applierName: doc.applierName ?? null,
		eventType: doc.eventType,
		fromStatus: doc.fromStatus ?? null,
		toStatus: doc.toStatus ?? null,
		actorType: doc.actorType || "system",
		actorName: doc.actorName ?? null,
		rejectReason: doc.rejectReason ?? null,
		rejectSource: doc.rejectSource ?? null,
		meta: doc.meta && typeof doc.meta === "object" ? doc.meta : null,
		createdAt:
			doc.createdAt instanceof Date
				? doc.createdAt.toISOString()
				: doc.createdAt ?? null,
	};
}

/**
 * List events for a task/job under an applier (newest last for timeline UI).
 */
export async function listBidReviewEvents({ applierName, taskId, jobId, limit = 200 }) {
	const collection = getBidReviewEventsCollection();
	if (!collection) return [];

	const name = String(applierName || "").trim();
	if (!name) return [];

	const or = [];
	if (taskId) or.push({ taskId: String(taskId) });
	if (jobId) or.push({ jobId: String(jobId) });
	if (or.length === 0) return [];

	const rows = await collection
		.find({ applierName: name, $or: or })
		.sort({ createdAt: 1 })
		.limit(Math.min(Math.max(Number(limit) || 200, 1), 500))
		.toArray();

	return rows.map(serializeBidReviewEvent).filter(Boolean);
}
