import { useApplier } from "@/context/applier-context";
import { useProfileKnowledgeGraph } from "../../knowledge-graph/hooks/useResumeAnalysisGraph";
import { ResumeSkillAnalysisView } from "../../resumes/components/analysis/ResumeSkillAnalysisView";

export function KnowledgeGraphSettingsTab() {
  const graph = useProfileKnowledgeGraph();

  return (
    <div className="h-[calc(100vh-14rem)] min-h-[520px] rounded-xl border border-border overflow-hidden bg-background">
      <ResumeSkillAnalysisView
        graph={graph}
        title="Profile skill analysis"
        description="Aggregated from all analyzed resumes (max strength per skill). React from one resume and Angular from another both appear here."
      />
    </div>
  );
}
