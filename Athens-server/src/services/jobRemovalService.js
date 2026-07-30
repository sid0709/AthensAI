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

export function normalizeCompanySiblingRemoval(body = {}) {
	const companyId = String(body?.companyId || "").trim();
	const keepJobId = String(body?.keepJobId || "").trim();
	if (!companyId || companyId.length > 1_500) return null;
	if (!keepJobId || keepJobId.includes("/") || keepJobId.length > 1_500) return null;
	return { companyId, keepJobId };
}

/** Resolve a company's physical job documents, requiring the preserved job to belong to it. */
export async function findOtherCompanyJobIds({ companyId, keepJobId, jobsCollection }) {
	const documents = await jobsCollection
		.find({ companyId }, { projection: { _id: 1 } })
		.toArray();
	const ids = [...new Set(documents.map((document) => String(document?._id || "").trim()).filter(Boolean))];
	if (!ids.includes(keepJobId)) {
		const error = new Error("The active job no longer belongs to this company group");
		error.code = "COMPANY_GROUP_CHANGED";
		throw error;
	}
	return ids.filter((id) => id !== keepJobId);
}
