import { useEffect, useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { BarChart3, TrendingUp } from "lucide-react";
import { listGenerationRuns } from "../../../services/resumeStorage";
import { useResumeStacks } from "../hooks/useResumeStacks";
import type { GenerationRun } from "../../../types/resume";

export function ResumeInsightsPanel() {
  const stacks = useResumeStacks();
  const [runs, setRuns] = useState<GenerationRun[]>([]);

  useEffect(() => {
    listGenerationRuns().then(setRuns);
  }, []);

  const recentRuns = useMemo(() => runs.slice(0, 5), [runs]);
  const successRate = useMemo(() => {
    if (!runs.length) return 0;
    return Math.round((runs.filter((r) => r.status === "completed").length / runs.length) * 100);
  }, [runs]);

  const weakSkills = useMemo(() => {
    if (!stacks.valid || !stacks.featuredStack) return [];
    const skills = stacks.catalog[stacks.featuredStack];
    if (!skills) return [];
    return Object.entries(skills)
      .filter(([, score]) => score < 6)
      .sort((a, b) => a[1] - b[1])
      .slice(0, 5)
      .map(([name, score]) => ({ name, score }));
  }, [stacks]);

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <InsightCard icon={BarChart3} label="Generations" value={String(runs.length)} sub="all time" />
        <InsightCard icon={TrendingUp} label="Success rate" value={`${successRate}%`} sub="completed runs" />
        <InsightCard icon={BarChart3} label="Skill stacks" value={String(stacks.stats.stackCount)} sub={`${stacks.stats.skillEntries} skills`} />
      </div>

      {weakSkills.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
          <h3 className="text-sm font-bold text-foreground mb-3">Skills to strengthen ({stacks.featuredStack})</h3>
          <div className="space-y-2">
            {weakSkills.map((s) => (
              <div key={s.name} className="flex items-center gap-3">
                <span className="text-sm text-foreground flex-1">{s.name}</span>
                <div className="w-24 h-1.5 bg-secondary rounded-full overflow-hidden">
                  <div className="h-full bg-amber-500 rounded-full" style={{ width: `${s.score * 10}%` }} />
                </div>
                <span className="text-xs font-mono text-muted-foreground w-6">{s.score}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
        <h3 className="text-sm font-bold text-foreground mb-3">Recent generations</h3>
        {recentRuns.length === 0 ? (
          <p className="text-sm text-muted-foreground">No generation runs yet. Use the Editor to generate a tailored resume.</p>
        ) : (
          <ul className="space-y-2">
            {recentRuns.map((run) => (
              <li key={run.id} className="flex items-center justify-between text-sm py-2 border-b border-border/50 last:border-0">
                <span className="text-foreground font-medium truncate flex-1">{run.jobTitle || "Resume generation"}</span>
                <span className="text-xs text-muted-foreground ml-2 shrink-0">
                  {formatDistanceToNow(new Date(run.createdAt), { addSuffix: true })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function InsightCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4 text-primary" />
        <span className="text-xs font-bold text-muted-foreground uppercase tracking-wide">{label}</span>
      </div>
      <p className="text-2xl font-bold text-foreground">{value}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
    </div>
  );
}
