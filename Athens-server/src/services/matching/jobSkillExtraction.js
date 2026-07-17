import { toCanonical } from '@nextoffer/shared/skill-normalize';
import { normalizeJobSkills } from './skillIndex.js';

/** Role/title filler — not treated as hiring-signal skills when parsed from title alone. */
const TITLE_STOP_WORDS = new Set([
	'senior', 'junior', 'lead', 'staff', 'principal', 'associate', 'intern',
	'engineer', 'developer', 'architect', 'manager', 'director', 'analyst',
	'specialist', 'consultant', 'contractor', 'remote', 'hybrid', 'onsite',
	'full', 'time', 'part', 'level', 'the', 'and', 'or', 'for', 'with',
	'mfd', 'mfx', 'ii', 'iii', 'iv', 'v', 'sr', 'jr',
]);

/**
 * Pull skill-like tokens from a job title (no hardcoded platform/role families).
 * Each user profile is matched against whatever skills the job actually requires.
 *
 * @param {string} title
 * @returns {string[]}
 */
export function extractSkillsFromTitle(title) {
	const t = String(title || '').trim();
	if (!t) return [];

	const rawTokens = t
		.split(/[\s/|,;()\-–—]+/)
		.map((s) => s.trim())
		.filter(Boolean);

	const skills = [];
	const seen = new Set();

	for (const token of rawTokens) {
		const canonical = toCanonical(token);
		if (!canonical || canonical.length < 2) continue;
		if (TITLE_STOP_WORDS.has(canonical)) continue;
		if (seen.has(canonical)) continue;
		seen.add(canonical);
		skills.push(token);
	}

	return skills;
}

/**
 * Merge title-derived skills into a job's skill list before normalization.
 *
 * @param {{ title?: string, skills?: string[] }} job
 * @returns {{ skills: string[], skillsNormalized: string[] }}
 */
export function enrichJobSkillsFromTitle(job) {
	const baseSkills = Array.isArray(job?.skills)
		? job.skills.map((s) => String(s).trim()).filter(Boolean)
		: [];

	const fromTitle = extractSkillsFromTitle(job?.title);
	const merged = [...baseSkills];
	const seen = new Set(merged.map((s) => toCanonical(s)).filter(Boolean));

	for (const skill of fromTitle) {
		const key = toCanonical(skill);
		if (!key || seen.has(key)) continue;
		seen.add(key);
		merged.push(skill);
	}

	return {
		skills: merged,
		skillsNormalized: normalizeJobSkills(merged),
	};
}
