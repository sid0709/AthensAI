import type { CoverageDecision, ResumeCoverageAnalysis, ResumeCoverageSkill } from "../types";

export function defaultCoverageDecision(
  skill: ResumeCoverageSkill,
  experienceRequirementThreshold: number,
): CoverageDecision {
  if (skill.evidenceStatus === "verified") return "used";
  return skill.requirement >= experienceRequirementThreshold ? "used" : "familiar";
}

export function defaultCoverageDecisions(
  analysis: ResumeCoverageAnalysis,
  experienceRequirementThreshold: number,
): Record<string, CoverageDecision> {
  return Object.fromEntries(
    analysis.skills.map((skill) => [
      skill.id,
      defaultCoverageDecision(skill, experienceRequirementThreshold),
    ]),
  );
}
