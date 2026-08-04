import type { CoverageDecision, ResumeCoverageAnalysis, ResumeCoverageSkill } from "../types";

export function defaultCoverageDecision(
  skill: ResumeCoverageSkill,
  _experienceRequirementThreshold: number,
): CoverageDecision {
  if (skill.decision === "used" || skill.decision === "familiar" || skill.decision === "exclude") {
    return skill.decision;
  }
  if (skill.evidenceStatus === "verified") return "used";
  return "familiar";
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
