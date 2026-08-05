#!/usr/bin/env node
import 'dotenv/config';
import { FieldValue } from 'firebase-admin/firestore';
import { jobStatusContribution, mergeJobStatusRows, resolveJobStatusState } from '@nextoffer/shared/job-status';
import { getFirestoreDb } from '../services/firebase/firebaseAdmin.js';
import { JOB_MARKET_MODEL_VERSION, isExtensionV2Job } from '../config/jobMarketSchema.js';
import { createProfileIdResolver, normalizeCanonicalJobStatuses } from '../services/canonicalJobStatus.js';
import {
	STATUS_PROJECTION_SCHEMA_VERSION,
	buildStatusProjectionData,
	jobStatusProjectionId,
	statusRowFromProjection,
} from '../services/jobStatusProjectionService.js';
import {
	JOB_CATALOG_COUNT_SHARDS,
	jobCatalogCountId,
	jobCatalogShard,
} from '../services/jobCatalogCountService.js';

const APPLY = process.argv.includes('--apply');
const RECONCILE = process.argv.includes('--reconcile');
const REPAIR = process.argv.includes('--repair');
const CLEANUP = process.argv.includes('--cleanup');
const BACKUP_CONFIRMED = process.argv.includes('--backup-confirmed');
const SOAK_CONFIRMED = process.argv.includes('--soak-confirmed');
const ALLOW_INVALID = process.argv.includes('--allow-invalid-statuses');
const STATUS_SHARDS = 16;
const JOBS = 'job_market';
const STATUSES = 'job_statuses';
const STATUS_COUNTS = 'job_status_counts';
const CATALOG_COUNTS = 'job_catalog_counts';
const CATALOG_MEMBERSHIPS = 'job_catalog_memberships';

function asDate(value) {
	if (value instanceof Date) return value;
	if (typeof value?.toDate === 'function') return value.toDate();
	const parsed = new Date(value || 0);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function sameDate(left, right) {
	return (asDate(left)?.getTime() || 0) === (asDate(right)?.getTime() || 0);
}

function statusShard(jobId) {
	return jobCatalogShard(jobId);
}

function emptyStatusCounts() {
	return { any: 0, applied: 0, scheduled: 0, declined: 0, 'bid-ready': 0, 'bid-completed': 0 };
}

function addCounts(target, values) {
	for (const key of Object.keys(target)) target[key] += Number(values[key] || 0);
}

function canonicalTitleReview(raw = {}) {
	const review = raw && typeof raw === 'object' ? { ...raw } : {};
	const label = review.label === 'APPROVED' || review.label === 'REVIEW_REQUIRED' ? review.label : null;
	const state = String(review.processingState || '').toLowerCase();
	if (label) {
		review.processingState = 'completed';
		review.label = label;
	} else if (state === 'failed') {
		review.processingState = 'failed';
		delete review.label;
	} else if (state === 'completed') {
		review.processingState = 'completed';
		review.label = 'REVIEW_REQUIRED';
	} else if (state === 'scanning') {
		review.processingState = 'scanning';
		delete review.label;
	} else {
		review.processingState = 'pending';
		delete review.label;
	}
	return review;
}

function titleReviewEqual(left, right) {
	return JSON.stringify(left || {}) === JSON.stringify(right || {});
}

function statusProjectionMatches(left, right) {
	if (!left || !right) return false;
	if (Number(left.schemaVersion) !== STATUS_PROJECTION_SCHEMA_VERSION) return false;
	for (const key of ['profileId', 'jobId', 'sourceCatalog', 'state', 'extensionV2', 'isPublic', 'visibleInJobSearch']) {
		if (String(left[key]) !== String(right[key])) return false;
	}
	for (const key of ['bidReadyAt', 'bidCompletedAt', 'appliedAt', 'scheduledAt', 'declinedAt', 'postedAt']) {
		if (!sameDate(left[key], right[key])) return false;
	}
	return true;
}

async function readAccounts(db) {
	const snapshot = await db.collection('account_info').select('name', 'tier').get();
	return snapshot.docs.map((document) => ({ _id: document.id, ...document.data() }));
}

async function readExistingStatuses(db) {
	const byJob = new Map();
	let count = 0;
	for await (const snapshot of db.collection(STATUSES).stream()) {
		const data = snapshot.data();
		const jobId = String(data.jobId || '').trim();
		if (!jobId) continue;
		const list = byJob.get(jobId) || [];
		list.push({ id: snapshot.id, ref: snapshot.ref, data });
		byJob.set(jobId, list);
		count += 1;
	}
	return { byJob, count };
}

async function validateEmbeddedStatuses(db, resolveProfileId) {
	let jobs = 0;
	let issueCount = 0;
	const issueSamples = [];
	for await (const snapshot of db.collection(JOBS).select('status').stream()) {
		jobs += 1;
		const { issues } = normalizeCanonicalJobStatuses(snapshot.data().status, resolveProfileId);
		issueCount += issues.length;
		for (const issue of issues.slice(0, Math.max(0, 25 - issueSamples.length))) {
			issueSamples.push({ jobId: snapshot.id, ...issue });
		}
	}
	return { jobs, issueCount, issueSamples };
}

async function deleteCollection(db, name) {
	let deleted = 0;
	const writer = db.bulkWriter();
	for await (const snapshot of db.collection(name).stream()) {
		writer.delete(snapshot.ref);
		deleted += 1;
	}
	await writer.close();
	return deleted;
}

function statusCounterKey(profileId, shard) {
	return `${profileId}_market_${String(shard).padStart(2, '0')}`;
}

async function buildExpectedState(db, { apply, repair }, accounts, existingStatuses) {
	const profileIds = new Set(accounts.map((account) => String(account._id)));
	const resolveProfileId = createProfileIdResolver(accounts);
	const statusCounts = new Map();
	const catalogCounts = Array.from({ length: JOB_CATALOG_COUNT_SHARDS }, () => ({ all: 0, public: 0 }));
	const seenExisting = new Set();
	const report = {
		jobs: 0,
		jobsPatched: 0,
		statusRowsExpected: 0,
		statusRowsWritten: 0,
		statusMismatches: 0,
		duplicateStatusDocuments: 0,
		orphanStatusDocuments: 0,
		invalidExistingProfiles: 0,
	};
	const writer = apply ? db.bulkWriter() : null;
	writer?.onWriteError((error) => error.failedAttempts < 5);

	for await (const snapshot of db.collection(JOBS).select(
		'status', 'postedAt', '_createdAt', 'createdAt', 'sourceCatalog', 'version', 'extensionV2',
		'titleReview', 'modelVersion',
	).stream()) {
		report.jobs += 1;
		const raw = snapshot.data();
		const postedAt = asDate(raw.postedAt || raw._createdAt || raw.createdAt) || new Date(0);
		const titleReview = canonicalTitleReview(raw.titleReview);
		const extensionV2 = isExtensionV2Job(raw);
		const job = { ...raw, postedAt, titleReview, sourceCatalog: 'market', extensionV2 };
		const patch = {};
		if (!sameDate(raw.postedAt, postedAt)) patch.postedAt = postedAt;
		if (raw.sourceCatalog !== 'market') patch.sourceCatalog = 'market';
		if (raw.extensionV2 !== extensionV2) patch.extensionV2 = extensionV2;
		if (!titleReviewEqual(raw.titleReview, titleReview)) patch.titleReview = titleReview;
		if (raw.modelVersion !== JOB_MARKET_MODEL_VERSION) patch.modelVersion = JOB_MARKET_MODEL_VERSION;
		if (Object.keys(patch).length) {
			report.jobsPatched += 1;
			if (writer) {
				writer.set(snapshot.ref, patch, { merge: true });
				writer.create(db.collection('search_outbox').doc(), {
					jobId: snapshot.id, operation: 'upsert', status: 'pending', attempts: 0,
					createdAt: new Date(), updatedAt: new Date(),
				});
			}
		}

		const shard = jobCatalogShard(snapshot.id);
		const approved = titleReview.label === 'APPROVED';
		const isPublic = approved && !extensionV2;
		catalogCounts[shard].all += Number(approved);
		catalogCounts[shard].public += Number(isPublic);
		if (writer) {
			writer.set(db.collection(CATALOG_MEMBERSHIPS).doc(snapshot.id), {
				schemaVersion: 1, jobId: snapshot.id, sourceCatalog: 'market', shard,
				approved, isPublic, updatedAt: new Date(),
			}, { merge: false });
		}

		const normalized = normalizeCanonicalJobStatuses(raw.status, resolveProfileId).statuses;
		const rowsByProfile = new Map(normalized.map((row) => [String(row.applier), [row]]));
		for (const existing of existingStatuses.byJob.get(snapshot.id) || []) {
			seenExisting.add(existing.id);
			const profileId = String(existing.data.profileId || '').trim();
			if (!profileIds.has(profileId)) {
				report.invalidExistingProfiles += 1;
				continue;
			}
			const row = statusRowFromProjection(existing.data);
			if (row) rowsByProfile.set(profileId, [...(rowsByProfile.get(profileId) || []), row]);
		}

		for (const [profileId, rows] of rowsByProfile) {
			const merged = mergeJobStatusRows(rows, profileId);
			if (!merged || resolveJobStatusState(merged) === 'posted') continue;
			const expected = buildStatusProjectionData({
				profileId,
				jobId: snapshot.id,
				job,
				statuses: [merged],
			});
			const targetId = jobStatusProjectionId(profileId, snapshot.id);
			const existingRows = (existingStatuses.byJob.get(snapshot.id) || [])
				.filter((item) => String(item.data.profileId || '') === profileId);
			const target = existingRows.find((item) => item.id === targetId);
			if (target) {
				expected.createdAt = asDate(target.data.createdAt) || expected.createdAt;
				expected.stateChangedAt = target.data.state === expected.state
					? asDate(target.data.stateChangedAt) || expected.stateChangedAt
					: expected.stateChangedAt;
				expected.lastMutationId = target.data.lastMutationId || null;
			}
			report.statusRowsExpected += 1;
			if (!statusProjectionMatches(target?.data, expected)) report.statusMismatches += 1;
			if (writer) {
				writer.set(db.collection(STATUSES).doc(targetId), expected, { merge: false });
				report.statusRowsWritten += 1;
			}
			for (const duplicate of existingRows.filter((item) => item.id !== targetId)) {
				report.duplicateStatusDocuments += 1;
				if (writer && repair) writer.delete(duplicate.ref);
			}

			if (expected.visibleInJobSearch) {
				const key = statusCounterKey(profileId, statusShard(snapshot.id));
				const counter = statusCounts.get(key) || {
					schemaVersion: 3,
					profileId,
					sourceCatalog: 'market',
					shard: statusShard(snapshot.id),
					all: emptyStatusCounts(),
					public: emptyStatusCounts(),
				};
				const contribution = jobStatusContribution(statusRowFromProjection(expected));
				addCounts(counter.all, contribution);
				if (expected.isPublic) addCounts(counter.public, contribution);
				statusCounts.set(key, counter);
			}
		}
	}

	for (const entries of existingStatuses.byJob.values()) {
		for (const existing of entries) {
			if (seenExisting.has(existing.id)) continue;
			report.orphanStatusDocuments += 1;
			if (writer && repair) writer.delete(existing.ref);
		}
	}

	if (writer) {
		for (const [id, counter] of statusCounts) {
			writer.set(db.collection(STATUS_COUNTS).doc(id), { ...counter, updatedAt: new Date() }, { merge: false });
		}
		for (let shard = 0; shard < catalogCounts.length; shard += 1) {
			writer.set(db.collection(CATALOG_COUNTS).doc(jobCatalogCountId(shard)), {
				schemaVersion: 3,
				sourceCatalog: 'market',
				shard,
				...catalogCounts[shard],
				updatedAt: new Date(),
			}, { merge: false });
		}
		await writer.close();
	}
	return { report, statusCounts, catalogCounts };
}

async function compareCounters(db, expected) {
	let statusDrift = 0;
	const storedStatus = await db.collection(STATUS_COUNTS).get();
	const storedById = new Map(storedStatus.docs.map((document) => [document.id, document.data()]));
	const allStatusIds = new Set([...storedById.keys(), ...expected.statusCounts.keys()]);
	for (const id of allStatusIds) {
		const left = storedById.get(id);
		const right = expected.statusCounts.get(id);
		if (JSON.stringify(left?.all || emptyStatusCounts()) !== JSON.stringify(right?.all || emptyStatusCounts())
			|| JSON.stringify(left?.public || emptyStatusCounts()) !== JSON.stringify(right?.public || emptyStatusCounts())) {
			statusDrift += 1;
		}
	}
	let catalogDrift = 0;
	for (let shard = 0; shard < expected.catalogCounts.length; shard += 1) {
		const snapshot = await db.collection(CATALOG_COUNTS).doc(jobCatalogCountId(shard)).get();
		const stored = snapshot.data() || {};
		const wanted = expected.catalogCounts[shard];
		if (Number(stored.all || 0) !== wanted.all || Number(stored.public || 0) !== wanted.public) catalogDrift += 1;
	}
	return { statusCounterShardDrift: statusDrift, catalogCounterShardDrift: catalogDrift };
}

const RETIRED_JOB_FIELDS = [
	'status', 'statusProfileIds', 'matchScoreStatus', 'matchScoredAt', 'matchScore',
	'scoreOverall', 'scoreSkill', 'scoreVector', 'scoreApplicant', 'scoreApplication', 'scoreSalary',
	'rankingVersion', 'recommendationRanked', 'personalizedScore', 'skillCoverage',
	'embedding', 'embeddingHash', 'embeddingStatus', 'embeddingModel', 'embeddingUpdatedAt',
	'vectorId', 'vectorSyncedAt', 'vectorSyncStatus',
];

async function cleanupRetiredData(db) {
	if (!APPLY || !BACKUP_CONFIRMED || !SOAK_CONFIRMED) {
		throw new Error('--cleanup requires --apply --backup-confirmed --soak-confirmed');
	}
	const writer = db.bulkWriter();
	let jobs = 0;
	for await (const snapshot of db.collection(JOBS).stream()) {
		writer.update(snapshot.ref, Object.fromEntries(RETIRED_JOB_FIELDS.map((field) => [field, FieldValue.delete()])));
		jobs += 1;
	}
	for await (const snapshot of db.collection('account_info').stream()) {
		writer.update(snapshot.ref, { profileBoostSkills: FieldValue.delete() });
	}
	for (const collection of ['user_resumes', 'user_knowledge_graphs']) {
		for await (const snapshot of db.collection(collection).stream()) {
			writer.update(snapshot.ref, { embedding: FieldValue.delete(), profileEmbedding: FieldValue.delete() });
		}
	}
	await writer.close();
	const retiredCollections = {};
	for (const name of ['user_skills', 'job_match_scores', 'match_profile_state', 'job_status_outbox']) {
		retiredCollections[name] = await deleteCollection(db, name);
	}
	return { jobs, retiredCollections };
}

async function main() {
	if ((APPLY || REPAIR || CLEANUP) && !BACKUP_CONFIRMED) {
		throw new Error('Write mode requires a completed managed Firestore export and --backup-confirmed');
	}
	if (REPAIR && !APPLY) throw new Error('--repair requires --apply');
	const db = getFirestoreDb();
	const accounts = await readAccounts(db);
	const resolveProfileId = createProfileIdResolver(accounts);
	const embeddedValidation = await validateEmbeddedStatuses(db, resolveProfileId);
	const existingStatuses = await readExistingStatuses(db);
	if (embeddedValidation.issueCount && APPLY && !ALLOW_INVALID) {
		throw new Error(`${embeddedValidation.issueCount} invalid embedded status value(s); fix them or explicitly pass --allow-invalid-statuses`);
	}

	if (APPLY) {
		await Promise.all([
			deleteCollection(db, STATUS_COUNTS),
			deleteCollection(db, CATALOG_COUNTS),
		]);
	}
	const expected = await buildExpectedState(db, { apply: APPLY, repair: REPAIR }, accounts, existingStatuses);
	const drift = await compareCounters(db, expected);
	const cleanup = CLEANUP ? await cleanupRetiredData(db) : null;
	const report = {
		mode: APPLY ? 'apply' : RECONCILE ? 'reconcile' : 'dry-run',
		generatedAt: new Date().toISOString(),
		accounts: accounts.length,
		existingStatusDocuments: existingStatuses.count,
		embeddedValidation,
		...expected.report,
		...drift,
		cleanup,
	};
	console.log(JSON.stringify(report, null, 2));
	if (RECONCILE && (report.statusMismatches || drift.statusCounterShardDrift || drift.catalogCounterShardDrift)) {
		process.exitCode = 2;
	}
}

main().catch((error) => {
	console.error('[firestore-first-migration] failed:', error?.stack || error);
	process.exitCode = 1;
});

