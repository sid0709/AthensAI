import React, { useMemo } from "react";
import { ScanSearch } from "lucide-react";
import { cn } from "../../../lib/utils";

type AiSkill = { name: string; category: string; requirement: number };

const CATEGORY_META: Record<string, { label: string; chip: string }> = {
  hard: { label: "Hard", chip: "border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300" },
  devops: { label: "DevOps", chip: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300" },
  tools: { label: "Tools", chip: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  domain: { label: "Domain", chip: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  soft: { label: "Soft", chip: "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300" },
};

const REQ_LABEL: Record<number, string> = {
  5: "Must-have",
  4: "Expected",
  3: "Relevant",
  2: "Nice-to-have",
  1: "Mentioned",
};

/** Job-owned extracted skills. These are displayed but never used to rank the list. */
export function DetectedSkillsPanel({ aiSkills }: { aiSkills?: AiSkill[] }) {
  const rows = useMemo(
    () => [...(aiSkills || [])].sort((left, right) => right.requirement - left.requirement || left.name.localeCompare(right.name)),
    [aiSkills],
  );
  if (!rows.length) {
    return (
      <section>
        <div className="mb-2 flex items-center gap-2">
          <span className="inline-flex size-7 items-center justify-center rounded-lg bg-primary/10">
            <ScanSearch className="size-4 text-primary" />
          </span>
          <h3 className="text-sm font-bold text-foreground">Detected skills</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          This job has not been analyzed yet. Run <span className="font-semibold">AI analyze</span> to detect its main skills.
        </p>
      </section>
    );
  }
  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <span className="inline-flex size-7 items-center justify-center rounded-lg bg-primary/10">
          <ScanSearch className="size-4 text-primary" />
        </span>
        <h3 className="text-sm font-bold text-foreground">Detected skills</h3>
        <span className="text-xs text-muted-foreground">{rows.length} found by AI</span>
      </div>
      <div className="space-y-1.5">
        {rows.map((skill) => {
          const meta = CATEGORY_META[skill.category] ?? CATEGORY_META.hard;
          return (
            <div key={`${skill.name}-${skill.category}`} className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-secondary/20 px-3 py-1.5">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-sm text-foreground">{skill.name}</span>
                <span className={cn("shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold", meta.chip)}>{meta.label}</span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="w-20 text-right text-[11px] text-muted-foreground">{REQ_LABEL[skill.requirement]}</span>
                <div className="flex gap-0.5" title={`Requirement ${skill.requirement}/5`}>
                  {[1, 2, 3, 4, 5].map((value) => (
                    <span key={value} className={cn("h-1.5 w-1.5 rounded-full", value <= skill.requirement ? "bg-primary" : "bg-border")} />
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
