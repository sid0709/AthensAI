import { toCanonical } from '@nextoffer/shared/skill-normalize';
import {
	userKnowledgeGraphsCollection,
	personalInfoCollection,
	userResumesCollection,
} from '../../db/mongo.js';
import {
	normalizeResumeSkillEntry,
	compareResumeSkills,
	legacyStrengthToLevel,
} from '../resumeSkillEntry.js';

export const PROFILE_GRAPH_ID = '__profile__';

function normalizeSkillInputs(skills = []) {
	const out = [];
	const seen = new Set();
	for (const item of skills) {
		let entry;
		if (typeof item === 'string') {
			entry = normalizeResumeSkillEntry({ name: item.trim(), category: 'hard', level: 4 });
		} else if (item && typeof item === 'object') {
			entry = normalizeResumeSkillEntry(item);
		} else {
			continue;
		}
		if (!entry) continue;
		const key = toCanonical(entry.name);
		if (!key || seen.has(key)) continue;
		seen.add(key);
		out.push(entry);
	}
	return out.slice(0, 200);
}

function graphSkillFromEntry({ name: raw, category, level }) {
	const canonical = toCanonical(raw);
	const legacyStrength = level * 2;
	return {
		surfaceForm: raw,
		name: raw,
		normalizedKey: canonical,
		canonicalId: canonical,
		category,
		level,
		strength: legacyStrength,
		proficiency: level / 5,
		sources: ['resume'],
	};
}

/**
 * Build or update a per-resume user knowledge graph (Mongo only).
 */
export async function buildUserGraphFromResume({
	applierName,
	resumeId,
	resumeName,
	skills = [],
}) {
	if (!userKnowledgeGraphsCollection) throw new Error('Database not ready');

	const name = String(applierName || '').trim();
	const rId = String(resumeId || 'default').trim();
	if (!name) throw new Error('applierName is required');

	const normalizedInputs = normalizeSkillInputs(skills);
	const resolvedSkills = normalizedInputs.map(graphSkillFromEntry);

	const now = new Date().toISOString();
	const doc = {
		applierName: name,
		resumeId: rId,
		resumeName: resumeName?.trim() || rId,
		skills: resolvedSkills,
		edges: [],
		updatedAt: now,
	};

	await userKnowledgeGraphsCollection.updateOne(
		{ applierName: name, resumeId: rId },
		{ $set: doc, $setOnInsert: { createdAt: now } },
		{ upsert: true },
	);

	return doc;
}

export async function listUserGraphs(applierName) {
	if (!userKnowledgeGraphsCollection) return [];
	const name = String(applierName || '').trim();
	if (!name) return [];
	return userKnowledgeGraphsCollection
		.find({ applierName: name })
		.sort({ updatedAt: -1 })
		.toArray();
}

export async function ensureDefaultUserGraphFromPersonal(applierName, personalSkills = []) {
	const skills = personalSkills.filter(Boolean);
	if (!skills.length) return null;
	return buildUserGraphFromResume({
		applierName,
		resumeId: 'personal-default',
		resumeName: 'Personal skills',
		skills,
	});
}

export async function mergeSkillsIntoPersonalInfo(skillNames = []) {
	if (!personalInfoCollection) return;
	const names = [...new Set(skillNames.map((s) => String(s).trim()).filter(Boolean))];
	for (const raw of names) {
		const canonical = toCanonical(raw);
		const doc = {
			name: raw,
			normalizedKey: canonical,
			canonicalId: canonical,
			createdAt: new Date().toISOString(),
		};
		await personalInfoCollection.updateOne({ name: raw }, { $set: doc }, { upsert: true });
	}
}

export async function rebuildProfileGraph(applierName) {
	const name = String(applierName || '').trim();
	if (!name || !userResumesCollection || !userKnowledgeGraphsCollection) return null;

	const analyzedResumes = await userResumesCollection
		.find({ ownerName: name, analyzed: true })
		.toArray();

	const skillByKey = new Map();
	for (const resume of analyzedResumes) {
		for (const raw of resume.skillProfile || []) {
			const entry = normalizeResumeSkillEntry(raw);
			if (!entry) continue;
			const key = toCanonical(entry.name);
			if (!key) continue;
			const prev = skillByKey.get(key);
			if (!prev || entry.level > prev.level) {
				skillByKey.set(key, entry);
			}
		}
	}

	const aggregatedSkills = [...skillByKey.values()].sort(compareResumeSkills);
	if (!aggregatedSkills.length) {
		await userKnowledgeGraphsCollection.deleteOne({
			applierName: name,
			resumeId: PROFILE_GRAPH_ID,
		});
		return null;
	}

	return buildUserGraphFromResume({
		applierName: name,
		resumeId: PROFILE_GRAPH_ID,
		resumeName: 'Profile knowledge',
		skills: aggregatedSkills,
	});
}

export function extractSeedCanonicalIds(graphs = []) {
	const ids = new Set();
	for (const g of graphs) {
		for (const s of g.skills || []) {
			const id = s.canonicalId || s.normalizedKey;
			if (id) ids.add(id);
		}
	}
	return [...ids];
}

export { legacyStrengthToLevel };
