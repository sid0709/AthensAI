import { Check, Loader2, Sparkles, X } from "lucide-react";
import { cn } from "../../../lib/utils";
import type { Job } from "../../../types";

type RequiredSkillsMatchProps = {
  job: Job;
  onRequestAddSkill?: (skill: string) => void;
  boostingSkill?: string | null;
};

function scoreBreakdown(job: Job): string | null {
  const { skillsCovered, skillsRequired, skill, vector } = job.scores;
  if (!skillsRequired) return null;

  const parts: string[] = [
    `${skillsCovered ?? 0}/${skillsRequired} required skills in your profile`,
    `${skill}% skill match`,
  ];
  if (vector != null && vector > 0) {
    parts.push(`${vector}% profile similarity`);
  }
  return parts.join(" · ");
}

export function RequiredSkillsMatch({
  job,
  onRequestAddSkill,
  boostingSkill = null,
}: RequiredSkillsMatchProps) {
  if (!job.skills.length) return null;

  const highlightMap = new Map(
    (job.skillHighlights ?? []).map((row) => [row.name.toLowerCase(), row.matched]),
  );
  const hasHighlights = highlightMap.size > 0;
  const breakdown = scoreBreakdown(job);
  const saving = Boolean(boostingSkill);

  return (
    <section>
      <div className="mb-1 flex items-center gap-2">
        <Sparkles className="size-4 text-primary" />
        <h3 className="text-sm font-bold text-foreground">Required skills</h3>
      </div>
      {breakdown ? (
        <p className="mb-3 text-xs text-muted-foreground">{breakdown}</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {job.skills.map((skill, index) => {
          const matched = hasHighlights ? highlightMap.get(skill.toLowerCase()) : undefined;
          const isMatched = matched === true;
          const isMissing = matched === false;
          const isBoosting = boostingSkill?.toLowerCase() === skill.toLowerCase();
          const canBoost = isMissing && onRequestAddSkill;

          return (
            <button
              key={`${skill}-${index}`}
              type="button"
              disabled={!canBoost || saving}
              onClick={() => {
                if (canBoost) onRequestAddSkill(skill);
              }}
              className={cn(
                "inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-semibold tracking-wide border transition-colors",
                isMatched && "bg-emerald-50 text-emerald-800 border-emerald-300",
                isMissing && "bg-secondary/60 text-muted-foreground border-border/80",
                canBoost && "cursor-pointer hover:border-primary/50 hover:bg-primary/5 hover:text-foreground",
                !canBoost && isMissing && "opacity-80",
                isBoosting && "opacity-70",
              )}
              title={
                isMatched
                  ? "In your profile — counts toward skill match"
                  : canBoost
                    ? "Click to add to your profile"
                    : isMissing
                      ? "Not in your profile"
                      : undefined
              }
            >
              {/* Icon lives in a stable wrapper span and the label in its own
                  span so swapping the icon (or a browser extension wrapping the
                  text) never reorders bare sibling nodes — avoids React's
                  insertBefore NotFoundError. */}
              {isBoosting || isMatched || isMissing ? (
                <span className="inline-flex size-3 shrink-0 items-center justify-center" aria-hidden>
                  {isBoosting ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : isMatched ? (
                    <Check className="size-3" />
                  ) : (
                    <X className="size-3 opacity-60" />
                  )}
                </span>
              ) : null}
              <span>{skill}</span>
            </button>
          );
        })}
      </div>
      {hasHighlights ? (
        <p className="mt-2.5 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1 mr-3">
            <span className="inline-block size-2 rounded-sm bg-emerald-400" aria-hidden />
            In your profile
          </span>
          <span className="inline-flex items-center gap-1 mr-3">
            <span className="inline-block size-2 rounded-sm bg-border" aria-hidden />
            Missing — click to add
          </span>
          <span className="text-muted-foreground/80">
            You can edit the skill name before saving; related requirements match automatically.
          </span>
        </p>
      ) : null}
    </section>
  );
}
