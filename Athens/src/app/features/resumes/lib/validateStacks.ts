import type { ResumeStackCatalog } from "../types/resume";

export interface StackValidationResult {
  valid: boolean;
  catalog: ResumeStackCatalog | null;
  error?: string;
}

export function validateStackCatalog(json: string): StackValidationResult {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { valid: false, catalog: null, error: "Root must be an object with stack names as keys." };
    }

    const catalog = parsed as ResumeStackCatalog;
    for (const [stack, skills] of Object.entries(catalog)) {
      if (typeof skills !== "object" || skills === null || Array.isArray(skills)) {
        return { valid: false, catalog: null, error: `Stack "${stack}" must map to an object of skill scores.` };
      }
      for (const [skill, score] of Object.entries(skills)) {
        if (typeof score !== "number" || score < 0 || score > 10) {
          return { valid: false, catalog: null, error: `Skill "${skill}" in "${stack}" must be a number 0–10.` };
        }
      }
    }

    return { valid: true, catalog };
  } catch {
    return { valid: false, catalog: null, error: "Invalid JSON syntax." };
  }
}

export function computeStackStats(catalog: ResumeStackCatalog) {
  const stacks = Object.keys(catalog);
  let skillEntries = 0;
  for (const skills of Object.values(catalog)) {
    skillEntries += Object.keys(skills).length;
  }
  return {
    stackCount: stacks.length,
    skillEntries,
    avgSkillsPerStack: stacks.length ? Math.round((skillEntries / stacks.length) * 10) / 10 : 0,
  };
}

export function stackToRadarData(stackName: string, catalog: ResumeStackCatalog) {
  const skills = catalog[stackName];
  if (!skills) return [];
  return Object.entries(skills).map(([dim, value]) => ({ dim, value }));
}

export function stackAvgScore(stackName: string, catalog: ResumeStackCatalog): number {
  const skills = catalog[stackName];
  if (!skills) return 0;
  const vals = Object.values(skills);
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
}
