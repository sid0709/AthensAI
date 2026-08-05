import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { isExtensionV2Job } from '../config/jobMarketSchema.js';
import { getFirestoreDb } from './firebase/firebaseAdmin.js';

const JOBS = 'jobs';
const MEMBERSHIP = 'job_catalog_memberships';
const COUNTS = 'job_catalog_counts';
const SHARDS = 16;

export function jobCatalogShard(jobId) {
	return Number.parseInt(createHash('sha256').update(String(jobId)).digest('hex').slice(0, 8), 16) % SHARDS;
}

export function jobCatalogCountId(shard) {
	return `market_${String(shard).padStart(2, '0')}`;
}

function approved(job) {
	return job?.titleReview?.label === 'APPROVED';
}

/** Idempotently synchronize derived approved-catalog counts for changed/deleted jobs. */
export async function syncApprovedCatalogMembership(jobIds = []) {
	const ids = [...new Set((jobIds || []).map(String).map((id) => id.trim()).filter(Boolean))];
	const db = getFirestoreDb();
	let changed = 0;
	for (const jobId of ids) {
		const jobRef = db.collection(JOBS).doc(jobId);
		const membershipRef = db.collection(MEMBERSHIP).doc(jobId);
		const shard = jobCatalogShard(jobId);
		const countRef = db.collection(COUNTS).doc(jobCatalogCountId(shard));
		changed += await db.runTransaction(async (transaction) => {
			const [jobSnapshot, membershipSnapshot] = await Promise.all([
				transaction.get(jobRef),
				transaction.get(membershipRef),
			]);
			const job = jobSnapshot.exists ? jobSnapshot.data() : null;
			const previous = membershipSnapshot.exists ? membershipSnapshot.data() : {};
			const nextApproved = approved(job);
			const nextPublic = nextApproved && !isExtensionV2Job(job);
			const deltaAll = Number(nextApproved) - Number(previous.approved === true);
			const deltaPublic = Number(nextPublic) - Number(previous.isPublic === true && previous.approved === true);
			if (deltaAll === 0 && deltaPublic === 0) return 0;
			transaction.set(countRef, {
				schemaVersion: 3,
				sourceCatalog: 'market',
				shard,
				all: FieldValue.increment(deltaAll),
				public: FieldValue.increment(deltaPublic),
				updatedAt: new Date(),
			}, { merge: true });
			transaction.set(membershipRef, {
				schemaVersion: 1,
				jobId,
				sourceCatalog: 'market',
				shard,
				approved: nextApproved,
				isPublic: nextPublic,
				updatedAt: new Date(),
			}, { merge: false });
			return 1;
		});
	}
	return { jobs: ids.length, changed };
}

export async function readApprovedCatalogCount({ includeExtensionV2 = true } = {}) {
	const db = getFirestoreDb();
	const snapshots = await db.getAll(...Array.from({ length: SHARDS }, (_, shard) => (
		db.collection(COUNTS).doc(jobCatalogCountId(shard))
	)));
	const existing = snapshots.filter((snapshot) => snapshot.exists);
	if (existing.length !== SHARDS) return null;
	const field = includeExtensionV2 ? 'all' : 'public';
	return existing.reduce((sum, snapshot) => sum + Math.max(0, Number(snapshot.data()?.[field] || 0)), 0);
}

export const JOB_CATALOG_COUNT_SHARDS = SHARDS;
