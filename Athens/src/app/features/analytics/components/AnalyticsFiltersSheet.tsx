import React from "react";
import { format, parseISO, isValid } from "date-fns";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../../../components/ui/sheet";
import { AthensMultiSelect, DatePicker } from "../../../components/forms";
import {
  ANALYTICS_SOURCE_TITLES,
  clearAnalyticsAttributeFilters,
  type AnalyticsFilterState,
} from "../lib/analyticsFilters";
import { defaultCustomSpan } from "../lib/dateRange";

type AnalyticsFiltersSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: AnalyticsFilterState;
  onChange: (filters: AnalyticsFilterState) => void;
};

function parseDateStr(value: string): Date | undefined {
  if (!value) return undefined;
  const parsed = parseISO(value);
  return isValid(parsed) ? parsed : undefined;
}

export function AnalyticsFiltersSheet({
  open,
  onOpenChange,
  filters,
  onChange,
}: AnalyticsFiltersSheetProps) {
  const patch = (partial: Partial<AnalyticsFilterState>) =>
    onChange({ ...filters, ...partial });

  const setCustomDay = (key: "customFrom" | "customTo", date?: Date) => {
    const next = date ? format(date, "yyyy-MM-dd") : "";
    const span = defaultCustomSpan();
    patch({
      range: "custom",
      customFrom: key === "customFrom" ? next : filters.customFrom || span.from,
      customTo: key === "customTo" ? next : filters.customTo || span.to,
    });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="athens-ui athens-sheet w-full sm:max-w-md overflow-y-auto p-0 gap-0">
        <SheetHeader className="athens-sheet-header space-y-0 p-0 text-left">
          <SheetTitle>Analytics filters</SheetTitle>
          <SheetDescription>Source and custom date range.</SheetDescription>
        </SheetHeader>

        <div className="athens-sheet-body">
          <section className="space-y-3">
            <h3 className="athens-eyebrow">Source</h3>
            <AthensMultiSelect
              label="Job source"
              values={filters.source}
              onChange={(source) => patch({ source })}
              placeholder="All sources"
              options={ANALYTICS_SOURCE_TITLES.map((title) => ({
                value: title,
                label: title,
              }))}
              tone="lens"
            />
          </section>

          <section className="space-y-3">
            <h3 className="athens-eyebrow">Custom range</h3>
            <div className="grid grid-cols-1 gap-3">
              <DatePicker
                label="From"
                value={parseDateStr(filters.customFrom)}
                onChange={(date) => setCustomDay("customFrom", date)}
                placeholder="Start date"
                tone="lens"
              />
              <DatePicker
                label="To"
                value={parseDateStr(filters.customTo)}
                onChange={(date) => setCustomDay("customTo", date)}
                placeholder="End date"
                tone="lens"
              />
            </div>
          </section>
        </div>

        <div className="athens-sheet-footer">
          <button
            type="button"
            className="athens-btn"
            onClick={() => onChange(clearAnalyticsAttributeFilters(filters))}
          >
            Reset section
          </button>
          <button type="button" className="athens-btn-primary" onClick={() => onOpenChange(false)}>
            Done
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
