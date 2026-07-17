import React, { useMemo } from "react";
import { Check, Loader2, Plus, ScanSearch } from "lucide-react";
import { cn } from "../../../lib/utils";
import { computeSkillHighlights, type ProfileMatchContext } from "../../../lib/skill-match";
import type { UserSkill } from "../hooks/useProfileMatchSkills";

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

function tokenize(s: string): string[] {
  return String(s)
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/)
    .filter(Boolean);
}

/** Find the user's skill that covers a detected skill (shared word token), for the "via" hint. */
function coveringUserSkill(detected: string, userSkills: UserSkill[]): UserSkill | null {
  const dTokens = new Set(tokenize(detected));
  for (const u of userSkills) {
    if (tokenize(u.name).some((t) => dTokens.has(t))) return u;
  }
  return null;
}

/**
 * Single skills view for the JD dialog. Shows every AI-detected skill with its
 * category and requirement (weight), whether the user covers it, and which of
 * the user's skills covers it — so the weighted match score is legible.
 */
export function DetectedSkillsPanel({
  aiSkills,
  matchContext,
  userSkills,
  score,
  covered,
  required,
  onRequestAddSkill,
  boostingSkill = null,
}: {
  aiSkills?: AiSkill[];
  matchContext: ProfileMatchContext | null;
  userSkills: UserSkill[];
  score: number;
  covered?: number;
  required?: number;
  onRequestAddSkill?: (skill: { name: string; category: string; requirement: number }) => void;
  boostingSkill?: string | null;
}) {
  const rows = useMemo(() => {
    if (!aiSkills?.length) return [];
    const highlights = matchContext ? computeSkillHighlights(aiSkills.map((s) => s.name), matchContext) : [];
    const matchedMap = new Map(highlights.map((h) => [h.name.toLowerCase(), h.matched]));
    return aiSkills
      .map((s) => ({
        ...s,
        matched: matchedMap.get(s.name.toLowerCase()) ?? false,
        via: matchedMap.get(s.name.toLowerCase()) ? coveringUserSkill(s.name, userSkills) : null,
      }))
      .sort((a, b) => b.requirement - a.requirement || Number(b.matched) - Number(a.matched));
  }, [aiSkills, matchContext, userSkills]);

  if (!aiSkills?.length) {
    return (
      <section>
        <div className="mb-2 flex items-center gap-2">
          <span className="inline-flex size-7 items-center justify-center rounded-lg bg-primary/10">
            <ScanSearch className="size-4 text-primary" />
          </span>
          <h3 className="text-sm font-bold text-foreground">Detected skills</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          This job hasn't been analyzed yet. Run <span className="font-semibold">Extract skills</span> from the
          toolbar to detect its skills and score your match.
        </p>
      </section>
    );
  }

  const total = rows.length;
  const coveredCount = covered ?? rows.filter((r) => r.matched).length;
  const requiredCount = required ?? total;

  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <span className="inline-flex size-7 items-center justify-center rounded-lg bg-primary/10">
          <ScanSearch className="size-4 text-primary" />
        </span>
        <h3 className="text-sm font-bold text-foreground">Detected skills</h3>
        <span className="text-xs text-muted-foreground">{total} found by AI</span>
      </div>

      {/* Score explainer */}
      <div className="mb-4 flex items-start gap-4 rounded-xl border border-border/60 bg-secondary/20 px-4 py-3">
        <div className="text-center shrink-0">
          <div className="text-2xl font-bold text-foreground tabular-nums">{score}%</div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">weighted match</div>
        </div>
        <div className="text-xs text-muted-foreground leading-relaxed">
          You cover <span className="font-semibold text-foreground">{coveredCount} of {requiredCount}</span> detected
          skills. Each skill counts by its <span className="font-medium">importance</span> (must-have &gt; nice-to-have)
          and <span className="font-medium">type</span> (hard &gt; soft), scaled by your proficiency — so covering the
          must-haves matters most.
        </div>
      </div>

      {/* Per-skill coverage + weight */}
      <div className="space-y-1.5">
        {rows.map((s) => {
          const meta = CATEGORY_META[s.category] ?? CATEGORY_META.hard;
          const isBoosting = boostingSkill?.toLowerCase() === s.name.toLowerCase();
          const canAdd = !s.matched && !!onRequestAddSkill;
          return (
            <div
              key={`${s.name}-${s.category}`}
              className={cn(
                "flex items-center justify-between gap-3 rounded-lg border px-3 py-1.5",
                s.matched ? "border-emerald-300/50 bg-emerald-50/50 dark:bg-emerald-500/5" : "border-border/60 bg-secondary/20",
              )}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="inline-flex size-4 shrink-0 items-center justify-center" aria-hidden>
                  {s.matched ? (
                    <Check className="size-3.5 text-emerald-600" />
                  ) : (
                    <span className="size-2 rounded-full bg-border" />
                  )}
                </span>
                <span className="text-sm text-foreground truncate">{s.name}</span>
                <span className={cn("shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold", meta.chip)}>
                  {meta.label}
                </span>
                {s.matched && s.via ? (
                  <span className="shrink-0 text-[11px] text-emerald-700/80 dark:text-emerald-300/70 truncate">
                    via {s.via.name}
                  </span>
                ) : canAdd ? (
                  <button
                    type="button"
                    disabled={boostingSkill !== null}
                    onClick={() => onRequestAddSkill?.({ name: s.name, category: s.category, requirement: s.requirement })}
                    className="shrink-0 inline-flex items-center gap-0.5 text-[11px] text-primary hover:underline disabled:opacity-50"
                  >
                    {isBoosting ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" />}
                    add
                  </button>
                ) : null}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[11px] text-muted-foreground w-20 text-right">{REQ_LABEL[s.requirement]}</span>
                <div className="flex gap-0.5" title={`Requirement ${s.requirement}/5`}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <span key={n} className={cn("h-1.5 w-1.5 rounded-full", n <= s.requirement ? "bg-primary" : "bg-border")} />
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Your skills */}
      {userSkills.length > 0 ? (
        <div className="mt-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
            Your skills ({userSkills.length})
          </div>
          <div className="flex flex-wrap gap-1.5">
            {userSkills.map((u) => (
              <span
                key={u.name}
                className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-secondary/40 px-1.5 py-0.5 text-[11px] text-foreground"
              >
                {u.name}
                <span className="font-mono text-[10px] text-muted-foreground">L{u.level}</span>
              </span>
            ))}
          </div>
        </div>
      ) : (
        <p className="mt-4 text-[11px] text-muted-foreground">
          Add your skills in <span className="font-semibold">My skills</span> to see coverage and score matches.
        </p>
      )}
    </section>
  );
}
