import { normalizeSkillSet, toCanonical } from '@nextoffer/shared/skill-normalize';
import { skillTokens } from '@nextoffer/shared/skill-tokens';

export function normalizeJobSkills(skills = []) {
	return [...normalizeSkillSet(skills)];
}

export function jobSkillTokens(skills = []) {
	const set = new Set();
	for (const skill of skills) for (const token of skillTokens(skill)) set.add(token);
	return [...set];
}

export function attachNormalizedSkills(job) {
	const skills = Array.isArray(job.skills) ? job.skills : [];
	return { ...job, skills, skillsNormalized: normalizeJobSkills(skills), skillTokens: jobSkillTokens(skills) };
}

export { toCanonical, normalizeSkillSet };
