import type { ResumeSkillEntry } from "../../../../types/resume";
import type { FullRun } from "./history-types";
import {
  normalizeSkillCategory,
  resolveSkillLevel,
  shortenSkillLabel,
} from "../../lib/skillCategories";

export function resolveRunSkillProfile(run: FullRun | null | undefined): ResumeSkillEntry[] {
  if (!run) return [];
  const stored = run.skillProfile;
  if (!Array.isArray(stored) || !stored.length) return [];
  return stored
    .map((s) => ({
      name: String(s?.name ?? "").trim(),
      category: normalizeSkillCategory(s?.category),
      level: resolveSkillLevel(s ?? {}),
    }))
    .filter((s) => s.name);
}

/** Top skills for radar axes — balanced count for readable chart labels. */
export function topSkillsForRadar(skills: ResumeSkillEntry[], limit = 10): ResumeSkillEntry[] {
  return [...skills].sort((a, b) => b.level - a.level).slice(0, limit);
}

export function skillRadarData(skills: ResumeSkillEntry[]) {
  const top = topSkillsForRadar(skills);
  return top.map((s) => ({
    dim: shortenSkillLabel(s.name),
    strength: s.level * 20,
  }));
}

export { shortenSkillLabel } from "../../lib/skillCategories";
