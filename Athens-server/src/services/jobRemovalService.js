/** Accept exact ids, plus the short-lived catalog-aware payload for compatibility. */
export function normalizeJobRemovalIds(body = {}) {
	const requested = Array.isArray(body?.ids)
		? body.ids
		: Array.isArray(body?.jobs)
			? body.jobs.map((job) => job?.id)
			: [];
	const seen = new Set();
	const ids = [];
	for (const value of requested) {
		const id = String(value || "").trim();
		if (!id || id.includes("/") || id.length > 1_500) continue;
		if (seen.has(id)) continue;
		seen.add(id);
		ids.push(id);
	}
	return ids;
}

/** Permanently delete exact documents from the physical jobs collection. */
export async function deleteJobDocuments({ ids, jobsCollection }) {
	return jobsCollection.deleteDocumentsByIds(ids);
}
