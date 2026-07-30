import { bumpCatalogRevision } from '../matching/jobRankingIndex.js';
import { patchJobListTitleReviewLabels } from '../jobListReadModelService.js';
import { updateJobRankingTitleReviewLabels } from '../vectorStore/qdrantClient.js';

/** Keep effective title-review labels synchronized with every Job Search read model. */
export async function syncJobTitleReviewUpdates(labelsByJobId, {
	updateIndexed = updateJobRankingTitleReviewLabels,
	bumpRevision = bumpCatalogRevision,
} = {}) {
	const updates = Object.entries(labelsByJobId || {}).flatMap(([jobId, label]) =>
		jobId && (label === 'APPROVED' || label === 'REVIEW_REQUIRED')
			? [{ jobId: String(jobId), label }]
			: [],
	);
	if (!updates.length) return { updated: 0, revision: null };
	patchJobListTitleReviewLabels(Object.fromEntries(updates.map(({ jobId, label }) => [jobId, label])));
	const updated = await updateIndexed(updates);
	const revision = await bumpRevision();
	return { updated, revision };
}

