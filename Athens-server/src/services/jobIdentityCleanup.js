import {
	jobIdentityRegistryCollection,
	jobsCollection,
} from "../db/dataStore.js";
import { removeJobEmbedding } from "./embeddings/embeddingIngest.js";
import { invalidateLiveProjectedStatusCount } from "./jobStatusProjectionService.js";
import { deleteScoresForJobs } from "./matching/matchScoreStore.js";
import { removeJobsFromRanking } from "./matching/jobRankingIndex.js";
import { removeJobFromRedisIndex } from "./matching/skillIndex.js";
import { selectExistingJobIdentityDuplicates } from "./jobIdentityDedupe.js";
import { randomUUID } from "node:crypto";

const CLEANUP_MARKER_ID = "job_identity_cleanup_v1";
const CLEANUP_LEASE_MS = 2 * 60 * 1000;
const CLEANUP_POLL_MS = 250;
const CLEANUP_CHUNK_SIZE = 100;

async function acquireCleanupLease(registryCollection) {
	const token = randomUUID();
	for (;;) {
		const marker = await registryCollection.findOne(
			{ _id: CLEANUP_MARKER_ID },
			{ bypassCache: true },
		);
		if (marker?.completedAt) return { completed: true, marker };
		const activeLeaseUntil = marker?.leaseUntil ? new Date(marker.leaseUntil).getTime() : 0;
		if (marker?.token && Number.isFinite(activeLeaseUntil) && activeLeaseUntil > Date.now()) {
			return { completed: false, busy: true, marker };
		}

		const now = new Date();
		let result = null;
		try {
			result = await registryCollection.updateOne(
				{ _id: CLEANUP_MARKER_ID, leaseUntil: { $lt: now.toISOString() } },
				{
					$set: {
						token,
						status: "running",
						leaseUntil: new Date(now.getTime() + CLEANUP_LEASE_MS).toISOString(),
						updatedAt: now.toISOString(),
					},
					$setOnInsert: { createdAt: now.toISOString() },
				},
				{ upsert: true },
			);
		} catch (error) {
			if (error?.code !== 11000) throw error;
		}
		if (result?.modifiedCount || result?.upsertedCount || result?.upsertedId) {
			return { completed: false, token };
		}
		await new Promise((resolve) => setTimeout(resolve, CLEANUP_POLL_MS));
	}
}

async function refreshCleanupLease(registryCollection, token) {
	const now = new Date();
	await registryCollection.updateOne(
		{ _id: CLEANUP_MARKER_ID, token },
		{
			$set: {
				leaseUntil: new Date(now.getTime() + CLEANUP_LEASE_MS).toISOString(),
				updatedAt: now.toISOString(),
			},
		},
	);
}

async function runLimited(values, limit, task) {
	let next = 0;
	async function worker() {
		for (;;) {
			const index = next;
			next += 1;
			if (index >= values.length) return;
			await task(values[index]);
		}
	}
	await Promise.all(
		Array.from({ length: Math.min(limit, values.length) }, () => worker()),
	);
}

/**
 * One-time destructive migration for pre-policy data. Jobs are grouped by the
 * same normalized company/title identity as live ingest; only the newest row
 * survives. Search/score side effects are removed before deleting the records.
 */
export async function cleanupExistingJobIdentityDuplicates({
	marketCollection = jobsCollection,
	registryCollection = jobIdentityRegistryCollection,
	deleteScores = deleteScoresForJobs,
	removeRanking = removeJobsFromRanking,
	removeSkillIndex = removeJobFromRedisIndex,
	removeEmbedding = removeJobEmbedding,
	invalidateStatusCounts = invalidateLiveProjectedStatusCount,
} = {}) {
	if (!marketCollection || !registryCollection) {
		return { scanned: 0, kept: 0, removed: 0, skipped: true };
	}
	const lease = await acquireCleanupLease(registryCollection);
	if (lease.completed) {
		return {
			scanned: Number(lease.marker?.scanned || 0),
			kept: Number(lease.marker?.kept || 0),
			removed: Number(lease.marker?.removed || 0),
			alreadyComplete: true,
		};
	}
	if (lease.busy) {
		return {
			scanned: Number(lease.marker?.scanned || 0),
			kept: Number(lease.marker?.kept || 0),
			removed: Number(lease.marker?.removed || 0),
			inProgress: true,
		};
	}

	let scanned = 0;
	try {
		const jobs = [];
		const projection = {
			title: 1,
			jobTitle: 1,
			company: 1,
			companyName: 1,
			_createdAt: 1,
			createdAt: 1,
			postedAt: 1,
		};
		const rows = typeof marketCollection.findPaged === "function"
			? marketCollection.findPaged({}, { projection, pageSize: 500 })
			: marketCollection.find({}, { projection });
		for await (const job of rows) {
			jobs.push(job);
			scanned += 1;
			if (scanned % 500 === 0) await refreshCleanupLease(registryCollection, lease.token);
		}

		const { keepers, duplicates } = selectExistingJobIdentityDuplicates(jobs);
		for (let offset = 0; offset < duplicates.length; offset += CLEANUP_CHUNK_SIZE) {
			const chunk = duplicates.slice(offset, offset + CLEANUP_CHUNK_SIZE);
			const ids = chunk.map((job) => job._id);
			await refreshCleanupLease(registryCollection, lease.token);
			// Firestore supports at most 30 values in an `in` query. Keep score
			// cleanup native-indexed instead of falling back to a collection scan.
			for (let scoreOffset = 0; scoreOffset < ids.length; scoreOffset += 25) {
				await deleteScores(ids.slice(scoreOffset, scoreOffset + 25));
				await refreshCleanupLease(registryCollection, lease.token);
			}
			await removeRanking(ids);
			await refreshCleanupLease(registryCollection, lease.token);
			await runLimited(ids, 10, removeSkillIndex);
			await runLimited(ids, 10, removeEmbedding);
			if (typeof marketCollection.bulkDeleteByIds === "function") {
				await marketCollection.bulkDeleteByIds(ids);
			} else {
				await marketCollection.deleteMany({ _id: { $in: ids } });
			}
			await refreshCleanupLease(registryCollection, lease.token);
		}

		if (duplicates.length) invalidateStatusCounts();
		const finishedAt = new Date().toISOString();
		await registryCollection.updateOne(
			{ _id: CLEANUP_MARKER_ID, token: lease.token },
			{
				$set: {
					status: "complete",
					completedAt: finishedAt,
					updatedAt: finishedAt,
					scanned,
					kept: keepers.length,
					removed: duplicates.length,
				},
				$unset: { token: "", leaseUntil: "" },
			},
		);
		return { scanned, kept: keepers.length, removed: duplicates.length };
	} catch (error) {
		await registryCollection.updateOne(
			{ _id: CLEANUP_MARKER_ID, token: lease.token },
			{
				$set: {
					status: "failed",
					error: error?.message || String(error),
					leaseUntil: new Date(0).toISOString(),
					updatedAt: new Date().toISOString(),
				},
			},
		).catch(() => {});
		throw error;
	}
}
