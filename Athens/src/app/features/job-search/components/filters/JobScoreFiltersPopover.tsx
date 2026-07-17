import React from "react";
import { BarChart3 } from "lucide-react";
import { Button } from "../../../../components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../../../../components/ui/popover";
import { cn } from "../../../../lib/utils";
import type { JobScoreFilters, JobSearchFilterState, ScoreRange } from "../../../../hooks/useJobSearchFilters";
import { clearScoreFilters, DEFAULT_SCORE_RANGE } from "../../../../hooks/useJobSearchFilters";

const SCORE_FIELDS: { key: keyof JobScoreFilters; label: string }[] = [
  { key: "overall", label: "Overall" },
  { key: "skill", label: "Skill" },
];

type JobScoreFiltersPopoverProps = {
  filters: JobSearchFilterState;
  onChange: (filters: JobSearchFilterState) => void;
  scoreCount: number;
  showOnCards: boolean;
  onShowOnCardsChange: (v: boolean) => void;
};

function ScoreRow({
  label,
  range,
  onChange,
}: {
  label: string;
  range: ScoreRange;
  onChange: (range: ScoreRange) => void;
}) {
  const clamp = (n: number) => Math.min(100, Math.max(0, n));
  const active = range.min !== 0 || range.max !== 100;

  return (
    <div className={cn("grid grid-cols-[72px_1fr_auto_1fr] items-center gap-2", active && "text-foreground")}>
      <span className="text-xs font-medium truncate">{label}</span>
      <input
        type="number"
        min={0}
        max={100}
        value={range.min}
        onChange={(e) => onChange({ ...range, min: clamp(Number(e.target.value) || 0) })}
        className="w-full bg-secondary/50 border border-border rounded-md px-2 py-1 text-xs font-mono outline-none focus:border-primary/40"
        aria-label={`${label} min`}
      />
      <span className="text-[10px] text-muted-foreground">–</span>
      <input
        type="number"
        min={0}
        max={100}
        value={range.max}
        onChange={(e) => onChange({ ...range, max: clamp(Number(e.target.value) || 100) })}
        className="w-full bg-secondary/50 border border-border rounded-md px-2 py-1 text-xs font-mono outline-none focus:border-primary/40"
        aria-label={`${label} max`}
      />
    </div>
  );
}

export function JobScoreFiltersPopover({
  filters,
  onChange,
  scoreCount,
  showOnCards,
  onShowOnCardsChange,
}: JobScoreFiltersPopoverProps) {
  const patchScore = (key: keyof JobScoreFilters, range: ScoreRange) =>
    onChange({ ...filters, scores: { ...filters.scores, [key]: range } });

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 gap-1.5 shrink-0">
          <BarChart3 className="w-4 h-4" />
          Scores
          {scoreCount > 0 && (
            <span className="ml-0.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold">
              {scoreCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="p-3 border-b border-border">
          <p className="text-sm font-semibold">Score ranges</p>
          <p className="text-xs text-muted-foreground mt-0.5">Filter by 0–100 score dimensions</p>
        </div>
        <div className="p-3 space-y-2.5 max-h-[320px] overflow-y-auto">
          {SCORE_FIELDS.map((field) => (
            <ScoreRow
              key={field.key}
              label={field.label}
              range={filters.scores[field.key]}
              onChange={(range) => patchScore(field.key, range)}
            />
          ))}
        </div>
        <div className="p-3 border-t border-border space-y-2">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showOnCards}
              onChange={(e) => onShowOnCardsChange(e.target.checked)}
              className="size-3.5 rounded border-border"
            />
            <span className="text-xs text-muted-foreground">Show scores on job cards</span>
          </label>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="flex-1 h-8 text-xs"
              onClick={() =>
                onChange({
                  ...filters,
                  scores: {
                    overall: { ...DEFAULT_SCORE_RANGE },
                    skill: { ...DEFAULT_SCORE_RANGE },
                  },
                })
              }
            >
              Reset
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="flex-1 h-8 text-xs"
              onClick={() => onChange(clearScoreFilters(filters))}
            >
              Clear all
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
