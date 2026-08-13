import { Sparkles } from "lucide-react";
import type { UseSkillGraphResult } from "../../../knowledge-graph/hooks/useSkillGraph";
import { toCategorizedSkills } from "../../lib/skillCategories";
import { ResumeSkillProfilePanel } from "./ResumeSkillProfilePanel";

type ResumeSkillAnalysisViewProps = {
  graph: UseSkillGraphResult;
  title?: string;
  description?: string;
};

export function ResumeSkillAnalysisView({
  graph,
  title,
  description,
}: ResumeSkillAnalysisViewProps) {
  const { skillStrengthList, loading, error } = graph;
  const skills = toCategorizedSkills(
    skillStrengthList.map((s) => ({
      name: s.label,
      category: "category" in s ? s.category : undefined,
      level: "level" in s && typeof s.level === "number" ? s.level : undefined,
      strength: s.strength,
    })),
  );

  if (loading && !skills.length) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground gap-2">
        <Sparkles className="w-5 h-5 animate-pulse text-primary" />
        Loading skill analysis…
      </div>
    );
  }

  if (error && !skills.length) {
    return (
      <div className="flex items-center justify-center h-full text-destructive text-sm px-8 text-center">
        {error}
      </div>
    );
  }

  return <ResumeSkillProfilePanel skills={skills} title={title} description={description} />;
}
