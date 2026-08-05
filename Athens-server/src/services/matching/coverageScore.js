import { clampScore } from '@nextoffer/shared/score';
import { buildProfileCompacts, jobSkillMatchesProfile } from '@nextoffer/shared/skill-match';
import { buildProfileTokens } from '@nextoffer/shared/skill-tokens';

function skillName(item) {
	if (typeof item === 'string') return item.trim();
	if (Array.isArray(item)) return String(item[0] || '').trim();
	return String(item?.name || '').trim();
}

/**
 * Compute a detail-only résumé-to-job skill coverage percentage.
 * This value is never written to the job catalog and never participates in list ordering.
 */
export function computeCoverageScore(jobSkills, resumeSkills) {
	const names = [...new Set(
		(Array.isArray(jobSkills) ? jobSkills : [...(jobSkills || [])])
			.map(skillName)
			.filter(Boolean),
	)];
	if (!names.length) return { matchScore: 0, covered: [], missing: [], required: 0 };

	const context = resumeSkills instanceof Set
		? {
			profileTokens: buildProfileTokens([...resumeSkills]),
			profileCompacts: buildProfileCompacts([...resumeSkills]),
		}
		: resumeSkills;
	const covered = [];
	const missing = [];
	for (const name of names) {
		if (jobSkillMatchesProfile(name, context)) covered.push(name);
		else missing.push(name);
	}
	return {
		matchScore: clampScore((covered.length / names.length) * 100),
		covered,
		missing,
		required: names.length,
	};
}

