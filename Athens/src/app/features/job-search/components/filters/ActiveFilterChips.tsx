import React from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { Button } from "../../../../components/ui/button";
import type { ActiveFilterChip } from "../../../../hooks/useJobSearchFilters";
import { clearAllFilters } from "../../../../hooks/useJobSearchFilters";
import type { JobSearchFilterState } from "../../../../hooks/useJobSearchFilters";

type ActiveFilterChipsProps = {
  filters: JobSearchFilterState;
  chips: ActiveFilterChip[];
  onChange: (filters: JobSearchFilterState) => void;
};

export function ActiveFilterChips({ filters, chips, onChange }: ActiveFilterChipsProps) {
  const [expanded, setExpanded] = React.useState(false);

  if (chips.length === 0) return null;

  const visible = expanded ? chips : chips.slice(0, 4);
  const hidden = chips.length - visible.length;

  return (
    <div className="flex items-center gap-2 flex-wrap px-1 pb-2">
      {visible.map((chip) => (
        <button
          key={chip.id}
          type="button"
          onClick={() => onChange(chip.apply(filters))}
          className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full text-xs font-medium bg-secondary border border-border text-foreground hover:bg-secondary/80 transition-colors"
        >
          {chip.label}
          <X className="w-3 h-3 text-muted-foreground" />
        </button>
      ))}
      {hidden > 0 && !expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="text-xs font-semibold text-primary hover:underline px-1"
        >
          +{hidden} more
        </button>
      )}
      {expanded && chips.length > 4 && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground px-1"
        >
          <ChevronUp className="w-3.5 h-3.5" />
          Less
        </button>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="h-7 text-xs text-muted-foreground ml-auto"
        onClick={() => onChange(clearAllFilters(filters))}
      >
        Clear all
      </Button>
    </div>
  );
}
