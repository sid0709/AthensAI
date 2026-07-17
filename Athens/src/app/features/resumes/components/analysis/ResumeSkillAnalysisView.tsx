import { Sparkles } from "lucide-react";
import { cn } from "../../../../lib/utils";
import { ResumeRadarChart } from "./ResumeRadarChart";
import type { UseSkillGraphResult } from "../../../knowledge-graph/hooks/useSkillGraph";
import {
  CATEGORY_META,
  CATEGORY_RADAR_COLORS,
  categoryRadarData,
  categoryRadarHeight,
  groupSkillsByCategory,
  type CategorizedSkill,
} from "../../lib/skillCategories";

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

  const skills: CategorizedSkill[] = skillStrengthList.map((s) => ({
    name: s.label,
    category: "category" in s && s.category ? s.category : "hard",
    level: "level" in s && typeof s.level === "number" ? s.level : Math.max(1, Math.min(5, Math.round(s.strength / 2))),
  }));

  const grouped = groupSkillsByCategory(skills);

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

  if (!skills.length) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center gap-3 px-8">
        <Sparkles className="w-10 h-10 text-muted-foreground/30" />
        <p className="text-sm font-semibold text-foreground">No skills extracted yet</p>
        <p className="text-xs text-muted-foreground max-w-sm">
          Re-run Analyze on selected resumes from the Library tab to extract categorized skills with levels 1–5.
        </p>
      </div>
    );
  }

  const avgLevel = skills.reduce((sum, s) => sum + s.level, 0) / skills.length;
  const topSkill = [...skills].sort((a, b) => b.level - a.level)[0];

  return (
    <div className="h-full overflow-y-auto subtle-scroll p-6 space-y-5">
      {title ? (
        <div>
          <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            {title}
          </h2>
          {description ? (
            <p className="text-xs text-muted-foreground mt-0.5 max-w-lg">{description}</p>
          ) : null}
        </div>
      ) : null}

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
                  {items.length} skill{items.length === 1 ? "" : "s"} · L1–5
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
