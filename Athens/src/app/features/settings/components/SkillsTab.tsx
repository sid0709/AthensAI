import React, { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { cn } from "../../../lib/utils";
import {
  useProfileMatchSkills,
  type UserSkill,
  type UserSkillCategory,
} from "../../job-search/hooks/useProfileMatchSkills";
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
 * Full-page skill editor (Settings → Skills). These manual skills are the sole
 * input to Best-match scoring. Matching is word-level ("React" also covers
 * "React Native"); hard skills weigh more than soft ones, and level scales the
 * weight. Editing a skill re-runs match scoring in the background.
 */
export function SkillsTab() {
  const { skills, loading, boostingSkill, addSkill, removeSkill } = useProfileMatchSkills();
  const [draft, setDraft] = useState("");
  const [draftCategory, setDraftCategory] = useState<UserSkillCategory>("hard");
  const [draftLevel, setDraftLevel] = useState(3);
  const [suggestions, setSuggestions] = useState<DictionarySkill[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const categoryTouched = useRef(false);

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
      if (!categoryTouched.current && rows[0]) setDraftCategory(rows[0].category);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [draft]);

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

  const applySuggestion = (s: DictionarySkill) => {
    setDraft(s.name);
    setDraftCategory(s.category);
    categoryTouched.current = false;
    setShowSuggestions(false);
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">My skills</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Best match scores each job against this list. Skills match by whole word —
          adding “React” also covers “React Native” and “React.js”. Hard skills weigh
          more than soft skills, and level (1–5) scales the weight. Changes re-score in
          the background.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 space-y-2">
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
            className="w-full h-9 rounded-md border border-border bg-secondary/60 px-3 text-sm text-foreground placeholder:text-muted-foreground/70 outline-none focus:border-primary/40 focus:ring-1 focus:ring-primary/10"
          />
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute z-30 mt-1 w-full rounded-md border border-border bg-popover shadow-md max-h-56 overflow-y-auto subtle-scroll">
              {suggestions.map((s) => (
                <button
                  key={s.nameCanonical}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    applySuggestion(s);
                  }}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-secondary"
                >
                  <span className="text-foreground truncate">{s.name}</span>
                  <span className="flex items-center gap-2 shrink-0 text-xs text-muted-foreground">
                    <span className="rounded bg-secondary px-1.5 py-0.5">{CATEGORY_META[s.category].label}</span>
                    <span className="font-mono tabular-nums">{s.jobCount} jobs</span>
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
            className="h-9 flex-1 rounded-md border border-border bg-secondary/60 px-2 text-sm text-foreground outline-none"
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
            className="h-9 w-32 rounded-md border border-border bg-secondary/60 px-2 text-sm text-foreground outline-none"
            aria-label="Proficiency level"
          >
            {LEVELS.map((lv) => (
              <option key={lv} value={lv}>
                Level {lv}
              </option>
            ))}
          </select>
          <Button
            className="h-9 gap-1.5"
            disabled={!draft.trim() || boostingSkill !== null}
            onClick={() => void submitDraft()}
          >
            {boostingSkill !== null ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Add
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading skills…
        </div>
      ) : skills.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No skills yet. Add your skills above — match scores are computed only from this list.
        </p>
      ) : (
        <div className="space-y-4">
          {grouped.map(({ category, items }) => (
            <div key={category}>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                {CATEGORY_META[category].label} · {items.length}
              </div>
              <div className="flex flex-wrap gap-2">
                {items.map((skill) => (
                  <span
                    key={skill.name}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm text-foreground",
                      CATEGORY_META[category].chip,
                      boostingSkill === skill.name && "opacity-50",
                    )}
                    title={skill.weight != null ? `Weight ${skill.weight.toFixed(2)}` : undefined}
                  >
                    {skill.name}
                    <span className="font-mono text-xs text-muted-foreground">L{skill.level}</span>
                    <button
                      type="button"
                      onClick={() => void removeSkill(skill.name)}
                      disabled={boostingSkill !== null}
                      className="text-muted-foreground hover:text-foreground"
                      aria-label={`Remove ${skill.name}`}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
