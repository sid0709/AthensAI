import { Sparkles } from "lucide-react";
import { cn } from "../../../../lib/utils";
import { ResumeRadarChart } from "../../components/analysis/ResumeRadarChart";
import {
  CATEGORY_META,
  CATEGORY_RADAR_COLORS,
  categoryRadarData,
  categoryRadarHeight,
  groupSkillsByCategory,
} from "../../lib/skillCategories";
import type { FullRun } from "./history-types";
import { resolveRunSkillProfile } from "./skill-profile-utils";

type GenerationSkillAnalysisProps = {
  run: FullRun;
};

export function GenerationSkillAnalysis({ run }: GenerationSkillAnalysisProps) {
  const skills = resolveRunSkillProfile(run);
  const grouped = groupSkillsByCategory(skills);

  if (!skills.length) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center rounded-xl border border-dashed border-border bg-secondary/20">
        <Sparkles className="w-10 h-10 text-muted-foreground/30 mb-3" />
        <p className="text-sm font-semibold text-foreground">No skill analysis yet</p>
        <p className="text-xs text-muted-foreground mt-1 max-w-sm">
          {run.skillAnalysisError
            ? `Analysis failed: ${run.skillAnalysisError}`
            : "Skill proficiency is computed automatically at the end of each new generation run."}
        </p>
      </div>
    );
  }

  const avgLevel = skills.reduce((sum, s) => sum + s.level, 0) / skills.length;
  const topSkill = [...skills].sort((a, b) => b.level - a.level)[0];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[
          { label: "Skills tracked", value: skills.length.toLocaleString() },
          { label: "Avg level", value: avgLevel.toFixed(1) },
          { label: "Top skill", value: topSkill ? `${topSkill.name} (L${topSkill.level})` : "—" },
        ].map((row) => (
          <div key={row.label} className="rounded-xl border border-border bg-card p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{row.label}</div>
            <div className="text-sm font-semibold text-foreground mt-1 truncate" title={row.value}>
              {row.value}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {grouped.map(({ category, items }) => {
          const radarData = categoryRadarData(items);
          const color = CATEGORY_RADAR_COLORS[category];
          return (
            <div key={category} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center justify-between gap-2 mb-2">
                <h4 className="text-sm font-semibold text-foreground">{CATEGORY_META[category].label}</h4>
                <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
                  {items.length} skill{items.length === 1 ? "" : "s"}
                </span>
              </div>
              <ResumeRadarChart
                data={radarData}
                series={[{ key: "strength", label: "Level", color }]}
                height={categoryRadarHeight(items.length)}
                compact={items.length > 6}
                domain={[0, 100]}
              />
              <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-border/60">
                {items.map((skill) => (
                  <span
                    key={`${category}-${skill.name}`}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold text-foreground",
                      CATEGORY_META[category].chip,
                    )}
                  >
                    {skill.name}
                    <span className="font-mono text-[10px] text-muted-foreground">L{skill.level}</span>
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
