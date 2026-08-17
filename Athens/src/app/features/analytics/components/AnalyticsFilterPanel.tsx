import React, { useState } from "react";
import { ChevronDown, ChevronUp, SlidersHorizontal, X } from "lucide-react";
import { cn } from "../../../lib/utils";
import type { ReportsTab } from "../../../config/routes";
import {
  ANALYTICS_RANGE_OPTIONS,
  countAnalyticsFilters,
  getAnalyticsFilterChips,
  type AnalyticsFilterState,
  type AnalyticsRange,
} from "../lib/analyticsFilters";
import { defaultCustomSpan } from "../lib/dateRange";
import { AnalyticsFiltersSheet } from "./AnalyticsFiltersSheet";

const TABS: { id: ReportsTab; label: string }[] = [
  { id: "postings", label: "Job postings" },
  { id: "applications", label: "My applications" },
];

type AnalyticsFilterPanelProps = {
  tab: ReportsTab;
  onTabChange: (tab: ReportsTab) => void;
  filters: AnalyticsFilterState;
  onChange: (filters: AnalyticsFilterState) => void;
};

export function AnalyticsFilterPanel({
  tab,
  onTabChange,
  filters,
  onChange,
}: AnalyticsFilterPanelProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [chipsOpen, setChipsOpen] = useState(true);
  const attributeCount = countAnalyticsFilters(filters);
  const chips = getAnalyticsFilterChips(filters);
  const hasChips = chips.length > 0;

  const patch = (partial: Partial<AnalyticsFilterState>) =>
    onChange({ ...filters, ...partial });

  const setRange = (range: AnalyticsRange) => {
    if (range === "custom") {
      const span = defaultCustomSpan();
      patch({
        range,
        customFrom: filters.customFrom || span.from,
        customTo: filters.customTo || span.to,
      });
      setSheetOpen(true);
      return;
    }
    patch({ range, customFrom: "", customTo: "" });
  };

  return (
    <div className="athens-toolbar mb-3">
      <div className="athens-surface">
        <div className="athens-tabs scroll-x-only" role="tablist" aria-label="Analytics view">
          {TABS.map((item) => {
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                aria-current={active ? "true" : undefined}
                onClick={() => onTabChange(item.id)}
                className={cn("athens-tab", active && "is-active")}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        <div className="athens-toolbar-row">
          <div
            className="athens-segment"
            role="group"
            aria-label="Time period"
          >
            {ANALYTICS_RANGE_OPTIONS.map((option) => {
              const active = filters.range === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={active}
                  className={cn(active && "is-active")}
                  onClick={() => setRange(option.value)}
                >
                  <span className="athens-segment__label">{option.label}</span>
                </button>
              );
            })}
          </div>

          <div className="athens-toolbar-actions ml-auto">
            <button
              type="button"
              className="athens-btn"
              onClick={() => setSheetOpen(true)}
            >
              <SlidersHorizontal size={16} aria-hidden="true" />
              Filters
              {attributeCount > 0 ? (
                <span className="athens-badge">{attributeCount}</span>
              ) : null}
            </button>
          </div>
        </div>

        {hasChips ? (
          <div>
            <button
              type="button"
              onClick={() => setChipsOpen((open) => !open)}
              className="athens-chips-toggle"
            >
              <span>
                {chips.length} active filter{chips.length !== 1 ? "s" : ""}
              </span>
              <ChevronDown
                size={14}
                aria-hidden="true"
                className={cn("transition-transform", chipsOpen && "rotate-180")}
              />
            </button>
            {chipsOpen ? (
              <AnalyticsFilterChips filters={filters} onChange={onChange} />
            ) : null}
          </div>
        ) : null}
      </div>

      <AnalyticsFiltersSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        filters={filters}
        onChange={onChange}
      />
    </div>
  );
}

function AnalyticsFilterChips({
  filters,
  onChange,
}: {
  filters: AnalyticsFilterState;
  onChange: (filters: AnalyticsFilterState) => void;
}) {
  const chips = getAnalyticsFilterChips(filters);
  const [expanded, setExpanded] = useState(false);
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
        <button type="button" onClick={() => setExpanded(true)} className="athens-text-btn">
          +{hidden} more
        </button>
      ) : null}
      {expanded && chips.length > 4 ? (
        <button type="button" onClick={() => setExpanded(false)} className="athens-text-btn">
          <ChevronUp size={14} aria-hidden="true" />
          Less
        </button>
      ) : null}
      <button
        type="button"
        className="athens-text-btn athens-chip-row__clear"
        onClick={() =>
          onChange({
            ...filters,
            range: filters.range === "custom" ? "30d" : filters.range,
            customFrom: "",
            customTo: "",
            source: [],
          })
        }
      >
        Clear all
      </button>
    </div>
  );
}
