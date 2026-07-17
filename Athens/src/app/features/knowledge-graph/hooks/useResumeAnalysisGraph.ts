import { useUserSkillAnalysis } from "./useUserSkillAnalysis";

const PROFILE_EXCLUDED = ["personal-default"] as const;
const RESUME_ANALYSIS_EXCLUDED = ["__profile__", "personal-default"] as const;

/**
 * Graph view for a single analyzed resume — activates only that resume's skill seeds.
 */
export function useResumeAnalysisGraph(selectedResumeId: string | null) {
  return useUserSkillAnalysis({
    fixedResumeId: selectedResumeId,
    excludeResumeIds: RESUME_ANALYSIS_EXCLUDED,
  });
}

/** Profile-level aggregate graph from Settings Knowledge Graph tab. */
export function useProfileKnowledgeGraph() {
  return useUserSkillAnalysis({
    fixedResumeId: "__profile__",
    excludeResumeIds: PROFILE_EXCLUDED,
  });
}
