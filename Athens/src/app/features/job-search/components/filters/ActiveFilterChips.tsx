import React from "react";
import { ChevronUp, X } from "lucide-react";
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
    <div className="athens-chip-row">
      {visible.map((chip) => (
        <button
          key={chip.id}
          type="button"
          onClick={() => onChange(chip.apply(filters))}
          className="athens-chip"
        >
          {chip.label}
          <X size={12} aria-hidden="true" />
        </button>
      ))}
      {hidden > 0 && !expanded ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="athens-text-btn"
        >
          +{hidden} more
        </button>
      ) : null}
      {expanded && chips.length > 4 ? (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="athens-text-btn"
        >
          <ChevronUp size={14} aria-hidden="true" />
          Less
        </button>
      ) : null}
      <button
        type="button"
        className="athens-text-btn athens-chip-row__clear"
        onClick={() => onChange(clearAllFilters(filters))}
      >
        Clear all
      </button>
    </div>
  );
}
