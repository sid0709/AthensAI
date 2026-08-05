import { inferJobSource, SOURCE_MAP_VERSION } from '../config/jobSources.js';

export async function ensureJobMarketIndexes(jobsCollection) {
	if (!jobsCollection) return;
	await Promise.all([
		jobsCollection.createIndex({ postedAt: -1 }),
		jobsCollection.createIndex({ url: 1 }),
		// Non-unique: URL policy remains app-level and time-bounded for extensions.
		jobsCollection.createIndex({ applyLink: 1 }),
		jobsCollection.createIndex({ source: 1, postedAt: -1 }),
		jobsCollection.createIndex({ companyId: 1, postedAt: -1 }),
		jobsCollection.createIndex({ version: 1, applyLink: 1 }),
		// AI skill-extraction session claims pending jobs; partial index stays small.
		jobsCollection.createIndex(
			{ aiSkillStatus: 1, postedAt: -1 },
			{ partialFilterExpression: { aiSkillStatus: 'pending' } },
		),
		// Title-review queue and quarantined-job listing.
		jobsCollection.createIndex({ 'titleReview.label': 1, postedAt: -1 }),
		jobsCollection.createIndex({ 'titleReview.label': 1, 'titleReview.confidence': -1, postedAt: -1 }),
		jobsCollection.createIndex({ 'titleReview.processingState': 1, postedAt: -1 }),
	]);
}

/**
 * Drop the legacy unique applyLink index so Extension can mirror a v2 job
 * under the same link, and so URL dedupe can remain app-level instead of forever.
 */
export async function dropLegacyUniqueApplyLinkIndex(jobsCollection) {
	if (!jobsCollection) return { dropped: false };
	try {
		const indexes = await jobsCollection.indexes();
		const uniqueApplyLink = indexes.find(
			(idx) =>
				idx.unique === true &&
				idx.key &&
				Object.keys(idx.key).length === 1 &&
				idx.key.applyLink === 1,
		);
		if (!uniqueApplyLink) return { dropped: false };
		await jobsCollection.dropIndex(uniqueApplyLink.name);
		console.log(`[job_market] dropped legacy unique index ${uniqueApplyLink.name}`);
		return { dropped: true, name: uniqueApplyLink.name };
	} catch (err) {
		console.warn('[job_market] drop unique applyLink index failed', err.message);
		return { dropped: false, error: err.message };
	}
}

/** Backfill denormalized `source` for older jobs missing it. */
export async function backfillMissingJobSourceFields(jobsCollection) {
	if (!jobsCollection) return { updated: 0 };
	const cursor = jobsCollection.find(
		{
			$or: [{ source: { $exists: false } }, { sourceVersion: { $ne: SOURCE_MAP_VERSION } }],
		},
		{ projection: { applyLink: 1 } },
	);

	let updated = 0;
	const batch = [];
	const flush = async () => {
		if (!batch.length) return;
		await jobsCollection.bulkWrite(batch, { ordered: false });
		updated += batch.length;
		batch.length = 0;
	};

	for await (const job of cursor) {
		batch.push({
			updateOne: {
				filter: { _id: job._id },
				update: {
					$set: {
						source: inferJobSource(job.applyLink),
						sourceVersion: SOURCE_MAP_VERSION,
					},
				},
			},
		});
		if (batch.length >= 200) await flush();
	}
	await flush();
	if (updated) console.log(`[job_market] backfilled source on ${updated} job(s)`);
	return { updated };
}

/**
 * Manual/ops helper: remove duplicate jobs sharing the same `applyLink`,
 * keeping only the latest one per link (by postedAt, then _createdAt, then _id).
 * Not run on startup — Extension and extension-v2 may intentionally share an
 * applyLink (v2 vs non-v2), and createJob enforces its URL policy in code.
 * Jobs without a non-empty string `applyLink` are left untouched.
 */
export async function dedupeJobMarketByApplyLink(jobsCollection) {
	if (!jobsCollection) return { removed: 0 };

	const groups = await jobsCollection
		.aggregate(
			[
				{ $match: { applyLink: { $type: 'string', $ne: '' } } },
				// latest first, so $first below is the one we keep
				{ $sort: { postedAt: -1, _createdAt: -1, _id: -1 } },
				{
					$group: {
						_id: '$applyLink',
						keepId: { $first: '$_id' },
						ids: { $push: '$_id' },
					},
				},
				// only groups with more than one document
				{ $match: { 'ids.1': { $exists: true } } },
			],
			{ allowDiskUse: true },
		)
		.toArray();

	const idsToRemove = [];
	for (const g of groups) {
		for (const id of g.ids) {
			if (!id.equals(g.keepId)) idsToRemove.push(id);
		}
	}

	if (!idsToRemove.length) return { removed: 0 };

	const result = await jobsCollection.deleteMany({ _id: { $in: idsToRemove } });
	console.log(`[job_market] removed ${result.deletedCount} duplicate applyLink job(s)`);
	return { removed: result.deletedCount };
}
