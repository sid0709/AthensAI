import { useMemo } from "react";
import { cn } from "../../../lib/utils";
import { SearchField } from "../../../components/shared/SearchField";
import type { SkillCategory, SkillRelationType } from "../../../types/knowledgeGraph";
import type { PendingSkill } from "@/app/api/skillGraph";
import { CATEGORY_HUE, CATEGORY_LABEL } from "../lib/graphAdapter";
import type { ProfileOption } from "../hooks/useSkillGraph";

const RELATION_TYPES: { type: SkillRelationType; label: string }[] = [
  { type: "PREREQUISITE_OF", label: "Prerequisite" },
  { type: "BUILDS_ON", label: "Builds on" },
  { type: "USED_WITH", label: "Used with" },
  { type: "RELATED_TO", label: "Related" },
  { type: "PART_OF", label: "Part of" },
];

const ALL_CATEGORIES: SkillCategory[] = [
  "language",
  "frontend",
  "backend",
  "cloud",
  "database",
  "devops",
  "data",
  "mobile",
  "concept",
];

type GraphToolbarProps = {
  profiles: ProfileOption[];
  activeResumeIds: Set<string>;
  onToggleResume: (id: string) => void;
  onSetAll: (active: boolean) => void;
  alpha: number;
  onAlphaChange: (a: number) => void;
  visibleRelations: Set<SkillRelationType>;
  onToggleRelation: (type: SkillRelationType) => void;
  onSearchSelect: (id: string) => void;
  search: string;
  onSearchChange: (value: string) => void;
  searchNodes: { id: string; label: string; category: SkillCategory }[];
  pendingSkills: PendingSkill[];
  matchScoreHint?: boolean;
  showProfiles?: boolean;
  hideActivationControls?: boolean;
  /** Profile/resume skill-only view — adjust helper copy. */
  profileSkillFocus?: boolean;
};

export function GraphToolbar({
  profiles,
  activeResumeIds,
  onToggleResume,
  onSetAll,
  alpha,
  onAlphaChange,
  visibleRelations,
  onToggleRelation,
  onSearchSelect,
  search,
  onSearchChange,
  searchNodes,
  pendingSkills,
  matchScoreHint,
  showProfiles = true,
  hideActivationControls = false,
  profileSkillFocus = false,
}: GraphToolbarProps) {
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return searchNodes.filter((n) => n.label.toLowerCase().includes(q)).slice(0, 8);
  }, [search, searchNodes]);

  const categoriesInGraph = useMemo(() => {
    const seen = new Set(searchNodes.map((n) => n.category));
    return ALL_CATEGORIES.filter((c) => seen.has(c));
  }, [searchNodes]);

  return (
    <div className="bg-card border border-border rounded-xl p-4 shadow-sm space-y-4 pointer-events-auto">
      {profileSkillFocus ? (
        <p className="text-[11px] text-muted-foreground rounded-lg bg-muted/30 px-2 py-1.5 border border-border/50">
          Dots are your analyzed skills (same list as Skill Strength). Toggle world graph context to see related skills from the global taxonomy.
        </p>
      ) : pendingSkills.length > 0 ? (
        <div className="space-y-2">
          <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Not in graph yet ({pendingSkills.length})
          </span>
          <ul className="max-h-32 overflow-y-auto subtle-scroll space-y-1">
            {pendingSkills.slice(0, 50).map((p) => (
              <li
                key={p.normalizedKey}
                className="text-[11px] text-muted-foreground truncate px-2 py-1 rounded-md bg-muted/40 border border-border/50"
                title={p.normalizedKey}
              >
                {p.surfaceForm}
              </li>
            ))}
          </ul>
          {pendingSkills.length > 50 ? (
            <p className="text-[10px] text-muted-foreground">+{pendingSkills.length - 50} more</p>
          ) : null}
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground rounded-lg bg-muted/30 px-2 py-1.5 border border-border/50">
          All queued skills are in the world graph.
        </p>
      )}

      <div className="space-y-2">
        {showProfiles ? (
          <>
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Active resumes
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onSetAll(true)}
              className="text-xs font-semibold text-primary hover:underline"
            >
              All
            </button>
            <span className="text-muted-foreground text-xs">/</span>
            <button
              type="button"
              onClick={() => onSetAll(false)}
              className="text-xs font-semibold text-muted-foreground hover:underline"
            >
              None
            </button>
          </div>
        </div>
        {profiles.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">No user resume graphs yet — add personal skills or upload a resume.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {profiles.map((p) => {
              const active = activeResumeIds.has(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  title={p.subtitle ?? p.name}
                  onClick={() => onToggleResume(p.id)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all max-w-full",
                    active
                      ? "bg-primary/10 border-primary/40 text-foreground"
                      : "bg-secondary border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "inline-block w-1.5 h-1.5 rounded-full mr-2 align-middle shrink-0",
                      active ? "bg-primary" : "bg-muted-foreground/40",
                    )}
                  />
                  <span className="truncate">{p.name}</span>
                </button>
              );
            })}
          </div>
        )}
          </>
        ) : null}
      </div>

      {!hideActivationControls ? (
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Activation spread
          </span>
          <span className="text-xs font-mono text-foreground">{alpha.toFixed(2)}</span>
        </div>
        <input
          type="range"
          min={0.4}
          max={0.95}
          step={0.01}
          value={alpha}
          onChange={(e) => onAlphaChange(Number(e.target.value))}
          className="w-full accent-[var(--primary)]"
          aria-label="Activation spread"
        />
        <p className="text-[11px] text-muted-foreground">
          Higher spread lets activation ripple further from your known skills.
        </p>
      </div>
      ) : (
        <p className="text-[11px] text-muted-foreground rounded-lg bg-muted/30 px-2 py-1.5 border border-border/50">
          Showing skills extracted from this resume only. Toggle world graph context to see related skills.
        </p>
      )}

      {!hideActivationControls ? (
      <div className="space-y-2">
        <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
          Relations
        </span>
        <div className="flex flex-wrap gap-1.5">
          {RELATION_TYPES.map((r) => {
            const active = visibleRelations.has(r.type);
            return (
              <button
                key={r.type}
                type="button"
                onClick={() => onToggleRelation(r.type)}
                className={cn(
                  "px-2.5 py-1 rounded-md text-[11px] font-semibold border transition-all",
                  active
                    ? "bg-secondary border-border text-foreground"
                    : "bg-transparent border-border/60 text-muted-foreground/60 line-through",
                )}
              >
                {r.label}
              </button>
            );
          })}
        </div>
      </div>
      ) : null}

      <div className="space-y-2 relative">
        <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
          Find skill
        </span>
        <SearchField
          value={search}
          onChange={onSearchChange}
          placeholder="Search world graph…"
          className="w-full"
        />
        {matches.length > 0 && (
          <div className="absolute z-10 left-0 right-0 mt-1 bg-popover border border-border rounded-lg shadow-lg overflow-hidden">
            {matches.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  onSearchSelect(m.id);
                  onSearchChange("");
                }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-secondary flex items-center gap-2"
              >
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ background: `hsl(${CATEGORY_HUE[m.category]}, 70%, 55%)` }}
                />
                {m.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2 pt-1 border-t border-border">
        <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
          Categories
        </span>
        <div className="flex flex-wrap gap-x-3 gap-y-1.5">
          {(categoriesInGraph.length ? categoriesInGraph : ALL_CATEGORIES).map((c) => (
            <span key={c} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span
                className="w-2.5 h-2.5 rounded-full"
                style={{ background: `hsl(${CATEGORY_HUE[c]}, 70%, 55%)` }}
              />
              {CATEGORY_LABEL[c]}
            </span>
          ))}
        </div>
      </div>

      {matchScoreHint ? (
        <p
          className="text-[10px] text-muted-foreground pt-1 border-t border-border leading-relaxed"
          title="Future: compare job skills against activation from your resume graph on the world skillset."
        >
          Match score (coming soon): overlap between job skills and activation seeded by your resume
          graph on the world skillset.
        </p>
      ) : null}
    </div>
  );
}
