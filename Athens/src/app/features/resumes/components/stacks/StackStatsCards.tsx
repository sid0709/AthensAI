import { KPI } from "../../../../components/ui";
import { Layers, Hash, BarChart3 } from "lucide-react";

type StackStatsCardsProps = {
  stackCount: number;
  skillEntries: number;
  avgSkillsPerStack: number;
};

export function StackStatsCards({ stackCount, skillEntries, avgSkillsPerStack }: StackStatsCardsProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <KPI label="Stacks" value={String(stackCount)} icon={Layers} accent="violet" />
      <KPI label="Skill entries" value={String(skillEntries)} icon={Hash} accent="blue" />
      <KPI label="Avg skills / stack" value={String(avgSkillsPerStack)} icon={BarChart3} accent="emerald" />
    </div>
  );
}
