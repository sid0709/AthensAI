import { clampScore } from '@nextoffer/shared/score';
import { computeSkillHighlights, jobSkillMatchesProfile, matchProficiency, buildProfileCompacts } from '@nextoffer/shared/skill-match';
import { buildProfileTokens } from '@nextoffer/shared/skill-tokens';
import { getSkillCategoryWeights } from '../../config/graphAndVectorConfig.js';

export { clampScore };

/**
 * Normalize job skills into `{ name, category, requirement }`. Plain strings
 * (legacy/display fields) become category `hard`, requirement 1 so a
 * not-yet-AI-extracted catalog still scores. Dedupe by normalized name.
 */
function normalizeJobSkillObjects(jobSkills) {
  const list = jobSkills instanceof Set ? [...jobSkills] : Array.isArray(jobSkills) ? jobSkills : [];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const name = typeof item === 'string' ? item : String(item?.name ?? '');
    const key = name.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({
      name,
      category: typeof item === 'object' && item?.category ? item.category : 'hard',
      requirement: typeof item === 'object' && Number(item?.requirement) ? Number(item.requirement) : 1,
    });
  }
  return out;
}

/**
 * Per-user coverage score. Two modes:
 *
 * - **Weighted** (profile ctx carries proficiency maps): each job skill is
 *   weighted by `requirement × categoryWeight(job skill's category)`, and a
 *   match contributes that × the user's `proficiencyFactor` (0..1). The
 *   denominator is weighted the same way, so a candidate who covers every skill
 *   at max proficiency scores exactly 100% (no suppression), while mandatory
 *   and hard-skill gaps cost the most.
 * - **Boolean** (plain Set / token-only ctx): legacy |matched| / |required| for
 *   detail views and tests.
 *
 * @param {Array<string|{name,category,requirement}>|Set<string>} jobSkills
 * @param {Set<string>|object} profileSkills
 * @returns {{ matchScore, covered: string[], missing: string[], required: number }}
 */
export function computeCoverageScore(jobSkills, profileSkills) {
  const ctx = profileSkills instanceof Set
    ? {
        profileTokens: buildProfileTokens([...profileSkills]),
        profileCompacts: buildProfileCompacts([...profileSkills]),
      }
    : profileSkills;

  const jobSkillObjs = normalizeJobSkillObjects(jobSkills);
  const required = jobSkillObjs.length;
  if (required === 0) {
    return { matchScore: 0, covered: [], missing: [], required: 0 };
  }

  const weighted = Boolean(ctx?.tokenWeights || ctx?.compactWeights?.length);
  const covered = [];
  const missing = [];

  if (!weighted) {
    for (const { name } of jobSkillObjs) {
      if (jobSkillMatchesProfile(name, ctx)) covered.push(name);
      else missing.push(name);
    }
    return { matchScore: clampScore((covered.length / required) * 100), covered, missing, required };
  }

  const catWeights = getSkillCategoryWeights();
  let denom = 0;
  let num = 0;
  for (const { name, category, requirement } of jobSkillObjs) {
    const catW = typeof catWeights[category] === 'number' ? catWeights[category] : (catWeights.hard ?? 1);
    denom += requirement * catW;
    const prof = matchProficiency(name, ctx); // 0..1 proficiency of best user match
    if (prof > 0) {
      covered.push(name);
      num += requirement * catW * prof;
    } else {
      missing.push(name);
    }
  }

  const matchScore = denom ? clampScore((num / denom) * 100) : 0;
  return { matchScore, covered, missing, required };
}

/**
 * Compose list-time job scores from coverage + optional vector similarity.
 */
export function composeJobScores(job, coverage, {
  vectorScore = null,
  matchContext = null,
  includeHighlights = false,
} = {}) {
  const skillScore = clampScore(coverage?.matchScore ?? 0);
  const matchScore = vectorScore !== null && vectorScore !== undefined
    ? clampScore(coverage?.finalScore ?? skillScore)
    : skillScore;

  const displaySkills = Array.isArray(job?.skills) ? job.skills.map((s) => String(s).trim()).filter(Boolean) : [];
  const skillHighlights = includeHighlights && matchContext
    ? computeSkillHighlights(displaySkills, matchContext)
    : undefined;

  return {
    matchScore,
    scoreSkill: skillScore,
    scoreVector: vectorScore !== null && vectorScore !== undefined ? clampScore(vectorScore) : null,
    scoreOverall: matchScore,
    skillsCovered: coverage?.covered?.length ?? 0,
    skillsRequired: coverage?.required ?? 0,
    skillsMissing: coverage?.missing ?? [],
    ...(skillHighlights ? { skillHighlights } : {}),
    recommendationRanked: true,
    _score: matchScore,
  };
}

/**
 * Blend skill containment with vector similarity (profile-specific, no role hardcoding).
 */
export function computeHybridScore(skillScore, vectorScore, weights = { skill: 0.55, vector: 0.45 }) {
  const wSkill = Number(weights.skill) || 0;
  const wVector = Number(weights.vector) || 0;
  const total = wSkill + wVector || 1;
  const skill = clampScore(skillScore);
  const vector = clampScore(vectorScore ?? 0);
  return clampScore((wSkill * skill + wVector * vector) / total);
}

export function applyScoreFilters(scoredJobs, scoreFilters) {
  if (!scoreFilters || !Object.keys(scoreFilters).length) return scoredJobs;
  const fieldMap = {
    overallScore: 'scoreOverall',
    skillMatch: 'scoreSkill',
  };
  return scoredJobs.filter((job) => {
    for (const [scoreKey, bounds] of Object.entries(scoreFilters)) {
      const field = fieldMap[scoreKey];
      if (!field) continue;
      const val = job[field];
      if (val === null || val === undefined) continue;
      if (bounds.min !== null && val < bounds.min) return false;
      if (bounds.max !== null && val > bounds.max) return false;
    }
    return true;
  });
}
