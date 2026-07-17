import { ObjectId } from 'mongodb';
import { getEmbeddingModel } from '../../config/graphAndVectorConfig.js';
import { jobsCollection, userResumesCollection } from '../../db/mongo.js';
import { PROFILE_GRAPH_ID } from '../userKnowledgeGraph/index.js';
import { normalizeResumeSkillEntry } from '../resumeSkillEntry.js';
import {
	buildJobEmbeddingText,
	buildProfileEmbeddingText,
	buildResumeEmbeddingText,
} from '../embeddings/embeddingText.js';
import { enrichJobSkillsFromTitle } from '../matching/jobSkillExtraction.js';
import { embedText } from '../embeddings/embeddingService.js';
import {
	deleteJobVector,
	deleteProfileVector,
	deleteResumeVector,
	getProfileVector,
	isQdrantReady,
	upsertJobVector,
	upsertProfileVector,
	upsertResumeVector,
} from '../vectorStore/qdrantClient.js';

async function aggregateProfileSkills(ownerName) {
	const name = String(ownerName || '').trim();
	if (!name || !userResumesCollection) return { skillProfile: [], primaryStacks: [] };

	const analyzed = await userResumesCollection
		.find({ ownerName: name, analyzed: true })
		.project({ skillProfile: 1, techStack: 1 })
		.toArray();

	const skillByKey = new Map();
	const stackSet = new Set();
	for (const resume of analyzed) {
		const stack = String(resume?.techStack ?? '').trim();
		if (stack) stackSet.add(stack);
		for (const raw of resume.skillProfile || []) {
			const entry = normalizeResumeSkillEntry(raw);
			if (!entry) continue;
			const key = entry.name.toLowerCase();
			const prev = skillByKey.get(key);
			if (!prev || entry.level > prev.level) {
				skillByKey.set(key, entry);
			}
		}
	}
	return {
		skillProfile: [...skillByKey.values()],
		primaryStacks: [...stackSet].slice(0, 20),
	};
}

export async function upsertJobEmbedding(jobId, { applierName } = {}) {
	if (!jobsCollection || !isQdrantReady()) return { skipped: true, reason: 'qdrant_not_ready' };

	let objectId;
	try {
		objectId = new ObjectId(jobId);
	} catch {
		return { skipped: true, reason: 'invalid_id' };
	}

	const job = await jobsCollection.findOne({ _id: objectId });
	if (!job) return { skipped: true, reason: 'not_found' };

	const enriched = enrichJobSkillsFromTitle(job);
	const text = buildJobEmbeddingText({ ...job, skills: enriched.skills });
	if (!text) return { skipped: true, reason: 'empty_text' };

	try {
		const { vector, textHash, model } = await embedText(text, { applierName, role: 'document' });
		await upsertJobVector(String(job._id), vector, {
			title: job.title || '',
			skills: enriched.skills.slice(0, 50),
			source: job.source || 'Other',
			postedAt: job.postedAt ? String(job.postedAt).slice(0, 10) : '',
		});

		await jobsCollection.updateOne(
			{ _id: objectId },
			{
				$set: {
					embedding: {
						model: model || getEmbeddingModel(),
						updatedAt: new Date().toISOString(),
						textHash,
					},
				},
			},
		);

		return { ok: true, jobId: String(job._id) };
	} catch (err) {
		console.warn(`[embedding] job ${jobId} failed:`, err.message);
		return { skipped: true, reason: err.message };
	}
}

/**
 * Embed a single analyzed resume (requires LLM skillProfile from analyze step).
 * Not called on upload — only after analyze or backfill.
 */
export async function upsertResumeEmbedding(resumeId, ownerName, { applierName } = {}) {
	if (!userResumesCollection || !isQdrantReady()) return { skipped: true, reason: 'qdrant_not_ready' };

	let objectId;
	try {
		objectId = new ObjectId(resumeId);
	} catch {
		return { skipped: true, reason: 'invalid_id' };
	}

	const name = String(ownerName || '').trim();
	const doc = await userResumesCollection.findOne({ _id: objectId, ownerName: name });
	if (!doc) return { skipped: true, reason: 'not_found' };
	if (!doc.analyzed || !Array.isArray(doc.skillProfile) || !doc.skillProfile.length) {
		return { skipped: true, reason: 'not_analyzed' };
	}

	const text = buildResumeEmbeddingText(doc);
	if (!text) return { skipped: true, reason: 'empty_text' };

	try {
		const { vector, textHash, model } = await embedText(text, {
			applierName: applierName || name,
			role: 'query',
		});
		await upsertResumeVector(String(doc._id), vector, {
			ownerName: name,
			techStack: doc.techStack || '',
			analyzedAt: doc.analyzedAt || null,
			kind: 'resume',
		});

		await userResumesCollection.updateOne(
			{ _id: objectId },
			{
				$set: {
					embedding: {
						model: model || getEmbeddingModel(),
						updatedAt: new Date().toISOString(),
						textHash,
					},
				},
			},
		);

		return { ok: true, resumeId: String(doc._id) };
	} catch (err) {
		console.warn(`[embedding] resume ${resumeId} failed:`, err.message);
		return { skipped: true, reason: err.message };
	}
}

/**
 * Embed aggregated profile skills (max strength per skill across analyzed resumes).
 */
export async function upsertProfileEmbedding(ownerName, { applierName } = {}) {
	if (!isQdrantReady()) return { skipped: true, reason: 'qdrant_not_ready' };

	const name = String(ownerName || '').trim();
	if (!name) return { skipped: true, reason: 'no_owner' };

	const { skillProfile, primaryStacks } = await aggregateProfileSkills(name);
	if (!skillProfile.length) {
		await deleteProfileVector(name);
		return { skipped: true, reason: 'no_analyzed_skills' };
	}

	const text = buildProfileEmbeddingText(name, skillProfile, { primaryStacks });
	if (!text) return { skipped: true, reason: 'empty_text' };

	try {
		const { vector, textHash, model } = await embedText(text, {
			applierName: applierName || name,
			role: 'query',
		});
		await upsertProfileVector(name, vector, {
			skillCount: skillProfile.length,
			updatedAt: new Date().toISOString(),
		});

		if (userResumesCollection) {
			await userResumesCollection.updateMany(
				{ ownerName: name },
				{
					$set: {
						profileEmbedding: {
							model: model || getEmbeddingModel(),
							updatedAt: new Date().toISOString(),
							textHash,
						},
					},
				},
			);
		}

		return { ok: true, ownerName: name, skillCount: skillProfile.length };
	} catch (err) {
		console.warn(`[embedding] profile ${name} failed:`, err.message);
		return { skipped: true, reason: err.message };
	}
}

/** After resume analyze: refresh this resume vector + aggregated profile vector. */
export async function syncEmbeddingsAfterResumeAnalysis(resumeId, ownerName, { applierName } = {}) {
	const resumeResult = await upsertResumeEmbedding(resumeId, ownerName, { applierName });
	const profileResult = await upsertProfileEmbedding(ownerName, { applierName });
	return { resume: resumeResult, profile: profileResult };
}

export function upsertJobEmbeddingAsync(jobId, opts = {}) {
	void upsertJobEmbedding(jobId, opts).catch((err) =>
		console.warn(`[embedding] async job ${jobId}:`, err.message),
	);
}

export function syncEmbeddingsAfterResumeAnalysisAsync(resumeId, ownerName, opts = {}) {
	void syncEmbeddingsAfterResumeAnalysis(resumeId, ownerName, opts).catch((err) =>
		console.warn(`[embedding] async sync resume ${resumeId}:`, err.message),
	);
}

export async function removeResumeEmbedding(resumeId) {
	await deleteResumeVector(resumeId);
}

export async function removeJobEmbedding(jobId) {
	await deleteJobVector(jobId);
}

export { getProfileVector, PROFILE_GRAPH_ID };
