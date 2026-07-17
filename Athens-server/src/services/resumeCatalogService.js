const MAX_STACKS = 120;
const MAX_SKILLS_PER_STACK = 80;
const MIN_SCORE = 0;
const MAX_SCORE = 10;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeScore(raw) {
  const num = Number(raw);
  if (!Number.isFinite(num)) return null;
  const rounded = Math.round(num);
  if (rounded < MIN_SCORE || rounded > MAX_SCORE) return null;
  return rounded;
}

/**
 * Validate and normalize resumes.json-shaped catalog.
 * @param {unknown} input
 * @returns {{
 *   valid: boolean;
 *   errors: string[];
 *   warnings: string[];
 *   catalog: Record<string, Record<string, number>> | null;
 *   stats: { stackCount: number; skillCount: number; avgSkillsPerStack: number } | null;
 * }}
 */
export function validateResumeCatalog(input) {
  const errors = [];
  const warnings = [];

  if (!isPlainObject(input)) {
    return {
      valid: false,
      errors: ['Root must be a JSON object (resume catalog shape).'],
      warnings,
      catalog: null,
      stats: null,
    };
  }

  const entries = Object.entries(input);
  if (entries.length === 0) {
    errors.push('Add at least one resume stack (top-level key).');
  }
  if (entries.length > MAX_STACKS) {
    errors.push(`Too many stacks (${entries.length}). Maximum is ${MAX_STACKS}.`);
  }

  const catalog = {};
  const stackNames = new Set();
  let totalSkills = 0;

  for (const [rawStackName, rawSkills] of entries) {
    const stackName = String(rawStackName ?? '').trim();
    if (!stackName) {
      errors.push('Stack name cannot be empty.');
      continue;
    }
    if (stackNames.has(stackName.toLowerCase())) {
      errors.push(`Duplicate stack name (case-insensitive): "${stackName}".`);
    }
    stackNames.add(stackName.toLowerCase());

    if (!isPlainObject(rawSkills)) {
      errors.push(`Stack "${stackName}" must be an object of skill scores.`);
      continue;
    }

    const skillEntries = Object.entries(rawSkills);
    if (skillEntries.length === 0) {
      warnings.push(`Stack "${stackName}" has no skills.`);
    }
    if (skillEntries.length > MAX_SKILLS_PER_STACK) {
      errors.push(`Stack "${stackName}" has too many skills (max ${MAX_SKILLS_PER_STACK}).`);
    }

    const normalizedSkills = {};
    const skillNames = new Set();
    for (const [rawSkillName, rawScore] of skillEntries) {
      const skillName = String(rawSkillName ?? '').trim();
      if (!skillName) {
        errors.push(`Stack "${stackName}" contains an empty skill name.`);
        continue;
      }
      if (skillNames.has(skillName.toLowerCase())) {
        warnings.push(`Stack "${stackName}" has duplicate skill "${skillName}" — kept first value.`);
        continue;
      }
      skillNames.add(skillName.toLowerCase());

      const score = normalizeScore(rawScore);
      if (score === null) {
        errors.push(
          `Stack "${stackName}" skill "${skillName}" must be a number from ${MIN_SCORE} to ${MAX_SCORE}.`,
        );
        continue;
      }
      normalizedSkills[skillName] = score;
    }

    if (Object.keys(normalizedSkills).length > 0) {
      catalog[stackName] = normalizedSkills;
      totalSkills += Object.keys(normalizedSkills).length;
    }
  }

  const stackCount = Object.keys(catalog).length;
  const stats =
    stackCount > 0
      ? {
          stackCount,
          skillCount: totalSkills,
          avgSkillsPerStack: Math.round((totalSkills / stackCount) * 10) / 10,
        }
      : null;

  return {
    valid: errors.length === 0 && stackCount > 0,
    errors,
    warnings,
    catalog: errors.length === 0 ? catalog : null,
    stats,
  };
}

export function emptyResumeCatalog() {
  return {};
}
