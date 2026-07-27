import { createHash, randomUUID } from "node:crypto";

export const JOB_IDENTITY_LOOKBACK_DAYS = 30;
export const JOB_IDENTITY_LOOKBACK_MS = JOB_IDENTITY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;

const BACKFILL_MARKER_ID = "job_identity_backfill_v1";
const BACKFILL_LEASE_MS = 2 * 60 * 1000;
const BACKFILL_POLL_MS = 250;
const IDENTITY_CLAIM_LEASE_MS = 10 * 60 * 1000;

const toValidDate = (value) => {
	if (!value) return null;
	const date = value instanceof Date
		? value
		: typeof value?.toDate === "function"
			? value.toDate()
			: new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
};

/** Canonical text used by the cross-source company/title identity policy. */
export function normalizeJobIdentityText(value) {
	return String(value ?? "")
		.normalize("NFKC")
		.trim()
		.replace(/\s+/gu, " ")
		.toLowerCase();
}

export function buildJobIdentity(companyName, title) {
	const companyKey = normalizeJobIdentityText(companyName);
	const titleKey = normalizeJobIdentityText(title);
	if (!companyKey || !titleKey) return null;
	const key = createHash("sha256")
		.update(`${companyKey}\0${titleKey}`)
		.digest("hex");
	return { key, companyKey, titleKey };
}

/** Backend-acceptance timestamp, with historical fallbacks for older records. */
export function resolveJobAcceptedAt(job, fallback = null) {
	for (const value of [job?._createdAt, job?.createdAt, job?.postedAt]) {
		const date = toValidDate(value);
		if (date) return date;
	}
	if (typeof job?._id?.getTimestamp === "function") {
		const objectIdDate = toValidDate(job._id.getTimestamp());
		if (objectIdDate) return objectIdDate;
	}
	return toValidDate(fallback);
}

function jobIdentityFromDocument(job) {
	return buildJobIdentity(
		typeof job?.company === "string"
			? job.company
			: job?.company?.name ?? job?.companyName,
		job?.title ?? job?.jobTitle,
	);
}

function compareJobsNewestFirst(left, right) {
	const leftTime = resolveJobAcceptedAt(left)?.getTime() ?? Number.NEGATIVE_INFINITY;
	const rightTime = resolveJobAcceptedAt(right)?.getTime() ?? Number.NEGATIVE_INFINITY;
	return rightTime - leftTime ||
		String(right?._id || "").localeCompare(String(left?._id || ""));
}

/** Group historical identity duplicates, always retaining the newest record. */
export function selectExistingJobIdentityDuplicates(jobs = []) {
	const groups = new Map();
	for (const job of jobs) {
		const identity = jobIdentityFromDocument(job);
		if (!identity) continue;
		if (!groups.has(identity.key)) groups.set(identity.key, []);
		groups.get(identity.key).push(job);
	}

	const keepers = [];
	const duplicates = [];
	for (const group of groups.values()) {
		if (group.length < 2) continue;
		const [keeper, ...older] = [...group].sort(compareJobsNewestFirst);
		keepers.push(keeper);
		duplicates.push(...older);
	}
	return { keepers, duplicates };
}

export function isWithinJobIdentityWindow(existingAcceptedAt, incomingAcceptedAt = new Date()) {
	const existing = toValidDate(existingAcceptedAt);
	const incoming = toValidDate(incomingAcceptedAt);
	if (!existing || !incoming) return true;
	return existing.getTime() >= incoming.getTime() - JOB_IDENTITY_LOOKBACK_MS;
}

function duplicateResult(identity, existing = null) {
	return {
		claimed: false,
		duplicate: true,
		identity,
		existingAcceptedAt: existing?.acceptedAt || null,
		existingJobId: existing?.jobId || null,
	};
}

/** Read-only form used by dry-run migrations. */
export async function findRecentJobIdentityDuplicate(
	registryCollection,
	{ companyName, title, acceptedAt = new Date() } = {},
) {
	const identity = buildJobIdentity(companyName, title);
	if (!registryCollection || !identity) return null;
	const existing = await registryCollection.findOne(
		{ _id: identity.key },
		{ projection: { acceptedAt: 1, jobId: 1 } },
	);
	return existing && isWithinJobIdentityWindow(existing.acceptedAt, acceptedAt)
		? duplicateResult(identity, existing)
		: null;
}

/**
 * Atomically reserve one company/title identity for its rolling 30-day window.
 * The conditional upsert works in MongoDB and in the Firestore compatibility
 * adapter: a recent document either produces a duplicate-key conflict or a
 * zero-row update, while an expired/missing document is claimed by one caller.
 */
export async function claimJobIdentity(
	registryCollection,
	{ companyName, title, acceptedAt = new Date(), source = "unknown" } = {},
) {
	const identity = buildJobIdentity(companyName, title);
	if (!registryCollection || !identity) {
		return { claimed: false, duplicate: false, skipped: true, identity };
	}

	const accepted = toValidDate(acceptedAt) || new Date();
	const acceptedAtIso = accepted.toISOString();
	const cutoffIso = new Date(accepted.getTime() - JOB_IDENTITY_LOOKBACK_MS).toISOString();
	const previous = await registryCollection.findOne(
		{ _id: identity.key },
		{ projection: { acceptedAt: 1, jobId: 1, source: 1, pending: 1, claimToken: 1, claimExpiresAt: 1 } },
	);
	if (previous && isWithinJobIdentityWindow(previous.acceptedAt, accepted)) {
		const claimExpired = previous.pending &&
			previous.claimToken &&
			toValidDate(previous.claimExpiresAt)?.getTime() <= Date.now();
		if (claimExpired) {
			const removed = await registryCollection.deleteOne({
				_id: identity.key,
				claimToken: previous.claimToken,
				pending: true,
			});
			if (removed?.deletedCount) {
				return claimJobIdentity(registryCollection, { companyName, title, acceptedAt, source });
			}
		}
		return duplicateResult(identity, previous);
	}

	const claimToken = randomUUID();
	let result;
	try {
		result = await registryCollection.updateOne(
			{ _id: identity.key, acceptedAt: { $lt: cutoffIso } },
			{
				$set: {
					companyKey: identity.companyKey,
					titleKey: identity.titleKey,
					acceptedAt: acceptedAtIso,
					source,
					claimToken,
					claimExpiresAt: new Date(Date.now() + IDENTITY_CLAIM_LEASE_MS).toISOString(),
					pending: true,
					updatedAt: new Date().toISOString(),
				},
				$setOnInsert: { createdAt: new Date().toISOString() },
			},
			{ upsert: true },
		);
	} catch (error) {
		if (error?.code !== 11000) throw error;
		const existing = await registryCollection.findOne(
			{ _id: identity.key },
			{ projection: { acceptedAt: 1, jobId: 1 } },
		);
		return duplicateResult(identity, existing);
	}

	if (!result?.modifiedCount && !result?.upsertedCount && !result?.upsertedId) {
		const existing = await registryCollection.findOne(
			{ _id: identity.key },
			{ projection: { acceptedAt: 1, jobId: 1 } },
		);
		return duplicateResult(identity, existing);
	}

	return {
		claimed: true,
		duplicate: false,
		identity,
		claimToken,
		acceptedAt: acceptedAtIso,
		previous: previous || null,
	};
}

export async function finalizeJobIdentityClaim(
	registryCollection,
	claim,
	{ jobId, source } = {},
) {
	if (!registryCollection || !claim?.claimed) return false;
	const result = await registryCollection.updateOne(
		{ _id: claim.identity.key, claimToken: claim.claimToken },
		{
			$set: {
				...(jobId != null ? { jobId: String(jobId) } : {}),
				...(source ? { source } : {}),
				pending: false,
				updatedAt: new Date().toISOString(),
			},
			$unset: { claimToken: "", claimExpiresAt: "" },
		},
	);
	return Boolean(result?.modifiedCount);
}

export async function releaseJobIdentityClaim(registryCollection, claim) {
	if (!registryCollection || !claim?.claimed) return false;
	if (claim.previous?.acceptedAt) {
		const result = await registryCollection.updateOne(
			{ _id: claim.identity.key, claimToken: claim.claimToken },
			{
				$set: {
					acceptedAt: claim.previous.acceptedAt,
					...(claim.previous.jobId ? { jobId: claim.previous.jobId } : {}),
					...(claim.previous.source ? { source: claim.previous.source } : {}),
					pending: false,
					updatedAt: new Date().toISOString(),
				},
				$unset: { claimToken: "", claimExpiresAt: "" },
			},
		);
		return Boolean(result?.modifiedCount);
	}
	const result = await registryCollection.deleteOne({
		_id: claim.identity.key,
		claimToken: claim.claimToken,
	});
	return Boolean(result?.deletedCount);
}

async function acquireBackfillLease(registryCollection) {
	const token = randomUUID();
	for (;;) {
		const marker = await registryCollection.findOne({ _id: BACKFILL_MARKER_ID });
		if (marker?.completedAt) return { completed: true };

		const now = new Date();
		const leaseUntil = new Date(now.getTime() + BACKFILL_LEASE_MS).toISOString();
		let result = null;
		try {
			result = await registryCollection.updateOne(
				{ _id: BACKFILL_MARKER_ID, leaseUntil: { $lt: now.toISOString() } },
				{
					$set: { token, leaseUntil, status: "running", updatedAt: now.toISOString() },
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
		await new Promise((resolve) => setTimeout(resolve, BACKFILL_POLL_MS));
	}
}

async function refreshBackfillLease(registryCollection, token) {
	const now = new Date();
	await registryCollection.updateOne(
		{ _id: BACKFILL_MARKER_ID, token },
		{
			$set: {
				leaseUntil: new Date(now.getTime() + BACKFILL_LEASE_MS).toISOString(),
				updatedAt: now.toISOString(),
			},
		},
	);
}

/** Idempotently seed the identity registry from current job_market rows. */
export async function backfillJobIdentityRegistry(jobsCollection, registryCollection) {
	if (!jobsCollection || !registryCollection) return { scanned: 0, identities: 0, skipped: true };
	const lease = await acquireBackfillLease(registryCollection);
	if (lease.completed) return { scanned: 0, identities: 0, alreadyComplete: true };

	let scanned = 0;
	try {
		const latest = new Map();
		const projection = {
			title: 1,
			jobTitle: 1,
			company: 1,
			companyName: 1,
			_createdAt: 1,
			createdAt: 1,
			postedAt: 1,
		};
		const rows = typeof jobsCollection.findPaged === "function"
			? jobsCollection.findPaged({}, { projection, pageSize: 2_000 })
			: jobsCollection.find({}, { projection });
		for await (const job of rows) {
			scanned += 1;
			const identity = jobIdentityFromDocument(job);
			const acceptedAt = resolveJobAcceptedAt(job);
			if (identity && acceptedAt) {
				const current = latest.get(identity.key);
				if (!current || acceptedAt.getTime() > current.acceptedAt.getTime()) {
					latest.set(identity.key, { ...identity, acceptedAt });
				}
			}
			if (scanned % 500 === 0) await refreshBackfillLease(registryCollection, lease.token);
		}

		const identities = [...latest.values()];
		const nowIso = new Date().toISOString();
		const operations = identities.map((identity) => ({
			updateOne: {
				filter: { _id: identity.key },
				update: {
					$set: {
						companyKey: identity.companyKey,
						titleKey: identity.titleKey,
						updatedAt: nowIso,
					},
					$max: { acceptedAt: identity.acceptedAt.toISOString() },
					$setOnInsert: { createdAt: nowIso, pending: false },
				},
				upsert: true,
			},
		}));
		if (typeof registryCollection.bulkUpsertById === "function") {
			await registryCollection.bulkUpsertById(operations);
			await refreshBackfillLease(registryCollection, lease.token);
		} else {
			for (let offset = 0; offset < operations.length; offset += 50) {
				await registryCollection.bulkWrite(
					operations.slice(offset, offset + 50),
					{ ordered: false },
				);
				await refreshBackfillLease(registryCollection, lease.token);
			}
		}

		await registryCollection.updateOne(
			{ _id: BACKFILL_MARKER_ID, token: lease.token },
			{
				$set: {
					status: "complete",
					completedAt: new Date().toISOString(),
					scanned,
					identities: identities.length,
					updatedAt: new Date().toISOString(),
				},
				$unset: { token: "", leaseUntil: "" },
			},
		);
		return { scanned, identities: identities.length };
	} catch (error) {
		await registryCollection.updateOne(
			{ _id: BACKFILL_MARKER_ID, token: lease.token },
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
