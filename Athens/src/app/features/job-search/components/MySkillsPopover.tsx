import React, { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Plus, Sparkles, X } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../../../components/ui/popover";
import { cn } from "../../../lib/utils";
import {
  useProfileMatchSkills,
  type UserSkill,
  type UserSkillCategory,
} from "../hooks/useProfileMatchSkills";
import { searchSkillDictionary, type DictionarySkill } from "../../../api/skillDictionary";

const CATEGORY_META: Record<UserSkillCategory, { label: string; chip: string }> = {
  hard: { label: "Hard skills", chip: "border-violet-500/40 bg-violet-500/10" },
  devops: { label: "DevOps", chip: "border-sky-500/40 bg-sky-500/10" },
  tools: { label: "Tools", chip: "border-emerald-500/40 bg-emerald-500/10" },
  domain: { label: "Domain", chip: "border-amber-500/40 bg-amber-500/10" },
  soft: { label: "Soft skills", chip: "border-rose-500/40 bg-rose-500/10" },
};

const CATEGORY_ORDER: UserSkillCategory[] = ["hard", "devops", "tools", "domain", "soft"];
const LEVELS = [1, 2, 3, 4, 5];

/**
 * Manage the manual skill list that drives weighted match scoring. Each skill
 * has a category and a 1-5 level; hard skills weigh more than soft skills and
 * higher levels weigh more than lower ones. Matching is word-level — adding
 * "React" also covers "React Native" / "React Program"; adding "C" covers
 * "C Programming" but never "Calculation".
 */
export function MySkillsPopover() {
  const { skills, loading, boostingSkill, addSkill, removeSkill } = useProfileMatchSkills();
  const [draft, setDraft] = useState("");
  const [draftCategory, setDraftCategory] = useState<UserSkillCategory>("hard");
  const [draftLevel, setDraftLevel] = useState(3);
  const [suggestions, setSuggestions] = useState<DictionarySkill[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  // Track whether the current category was auto-prefilled (so typing more can re-prefill).
  const categoryTouched = useRef(false);

  // Debounced dictionary autocomplete on the draft name.
  useEffect(() => {
    const q = draft.trim();
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      const rows = await searchSkillDictionary(q, { mode: "prefix", limit: 8 });
      if (cancelled) return;
      setSuggestions(rows);
      // Prefill category from the top match until the user overrides it.
      if (!categoryTouched.current && rows[0]) setDraftCategory(rows[0].category);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [draft]);

  const applySuggestion = (s: DictionarySkill) => {
    setDraft(s.name);
    setDraftCategory(s.category);
    categoryTouched.current = false;
    setShowSuggestions(false);
  };

  const grouped = useMemo(() => {
    const byCategory = new Map<UserSkillCategory, UserSkill[]>();
    for (const skill of skills) {
      const list = byCategory.get(skill.category) ?? [];
      list.push(skill);
      byCategory.set(skill.category, list);
    }
    return CATEGORY_ORDER.filter((c) => byCategory.has(c)).map((c) => ({
      category: c,
      items: byCategory.get(c)!,
    }));
  }, [skills]);

  const submitDraft = async () => {
    const label = draft.trim();
    if (!label) return;
    const added = await addSkill(label, draftCategory, draftLevel);
    if (added) {
      setDraft("");
      setSuggestions([]);
      categoryTouched.current = false;
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 gap-1.5 shrink-0">
          <Sparkles className="w-4 h-4" />
          My skills
          {skills.length > 0 && (
            <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-violet-600 text-white text-[10px] font-bold">
              {skills.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="px-3 py-2.5 border-b border-border">
          <div className="text-sm font-semibold text-foreground">My skills</div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Hard skills count most, soft skills least; level scales the weight.
            “React” also covers “React Native”. Scores refresh in the background.
          </p>
        </div>

        <div className="px-3 py-2.5 space-y-3">
          <div className="space-y-2">
            <div className="relative">
              <input
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setShowSuggestions(true);
                }}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 120)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submitDraft();
                  if (e.key === "Escape") setShowSuggestions(false);
                }}
                placeholder="Add a skill (e.g. React, AWS, Mentoring)…"
                className="w-full h-8 rounded-md border border-border bg-secondary/60 px-2.5 text-sm text-foreground placeholder:text-muted-foreground/70 outline-none focus:border-primary/40 focus:ring-1 focus:ring-primary/10"
              />
              {showSuggestions && suggestions.length > 0 && (
                <div className="absolute z-30 mt-1 w-full rounded-md border border-border bg-popover shadow-md max-h-48 overflow-y-auto subtle-scroll">
                  {suggestions.map((s) => (
                    <button
                      key={s.nameCanonical}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        applySuggestion(s);
                      }}
                      className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-secondary"
                    >
                      <span className="text-foreground truncate">{s.name}</span>
                      <span className="flex items-center gap-1.5 shrink-0 text-muted-foreground">
                        <span className="rounded bg-secondary px-1 py-0.5">{CATEGORY_META[s.category].label}</span>
                        <span className="font-mono tabular-nums">{s.jobCount}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <select
                value={draftCategory}
                onChange={(e) => {
                  categoryTouched.current = true;
                  setDraftCategory(e.target.value as UserSkillCategory);
                }}
                className="h-8 flex-1 rounded-md border border-border bg-secondary/60 px-2 text-xs text-foreground outline-none"
                aria-label="Skill category"
              >
                {CATEGORY_ORDER.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_META[c].label}
                  </option>
                ))}
              </select>
              <select
                value={draftLevel}
                onChange={(e) => setDraftLevel(Number(e.target.value))}
                className="h-8 w-24 rounded-md border border-border bg-secondary/60 px-2 text-xs text-foreground outline-none"
                aria-label="Skill level"
              >
                {LEVELS.map((lv) => (
                  <option key={lv} value={lv}>
                    Level {lv}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                className="h-8 px-2.5"
                disabled={!draft.trim() || boostingSkill !== null}
                onClick={() => void submitDraft()}
              >
                {boostingSkill !== null ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Plus className="w-3.5 h-3.5" />
                )}
              </Button>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
            </div>
          ) : skills.length === 0 ? (
            <p className="text-xs text-muted-foreground/80 py-1">
              No skills yet. Add your skills above (or click a skill tag on a job) —
              match scores are computed only from this list.
            </p>
          ) : (
            <div className="space-y-2.5 max-h-72 overflow-y-auto subtle-scroll">
              {grouped.map(({ category, items }) => (
                <div key={category}>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                    {CATEGORY_META[category].label}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {items.map((skill) => (
                      <span
                        key={skill.name}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs text-foreground",
                          CATEGORY_META[category].chip,
                          boostingSkill === skill.name && "opacity-50",
                        )}
                        title={`Level ${skill.level}${skill.weight != null ? ` · weight ${skill.weight.toFixed(2)}` : ""}`}
                      >
                        {skill.name}
                        <span className="font-mono text-[10px] text-muted-foreground">
                          L{skill.level}
                        </span>
                        <button
                          type="button"
                          onClick={() => void removeSkill(skill.name)}
                          disabled={boostingSkill !== null}
                          className="text-muted-foreground hover:text-foreground"
                          aria-label={`Remove ${skill.name}`}
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
