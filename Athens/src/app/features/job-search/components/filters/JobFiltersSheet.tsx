import React from "react";
import { format, parseISO, isValid } from "date-fns";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../../../../components/ui/sheet";
import { AthensMultiSelect, DatePicker } from "../../../../components/forms";
import { JobSourceTitles } from "../../../../data/jobs/pub";
import type { JobSearchFilterState } from "../../../../hooks/useJobSearchFilters";
import { clearAttributeFilters } from "../../../../hooks/useJobSearchFilters";

type JobFiltersSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: JobSearchFilterState;
  onChange: (filters: JobSearchFilterState) => void;
};

function parseDateStr(s: string): Date | undefined {
  if (!s) return undefined;
  const d = parseISO(s);
  return isValid(d) ? d : undefined;
}

export function JobFiltersSheet({
  open,
  onOpenChange,
  filters,
  onChange,
}: JobFiltersSheetProps) {
  const patch = (partial: Partial<JobSearchFilterState>) => onChange({ ...filters, ...partial });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="athens-ui athens-sheet w-full sm:max-w-md overflow-y-auto p-0 gap-0">
        <SheetHeader className="athens-sheet-header space-y-0 p-0 text-left">
          <SheetTitle>Attribute filters</SheetTitle>
          <SheetDescription>Source and posted date.</SheetDescription>
        </SheetHeader>

        <div className="athens-sheet-body">
          <section className="space-y-3">
            <h3 className="athens-eyebrow">Source</h3>
            <AthensMultiSelect
              label="Job source"
              values={filters.source}
              onChange={(source) => patch({ source })}
              placeholder="All sources"
              options={JobSourceTitles.map((s) => ({ value: s, label: s }))}
              tone="lens"
            />
          </section>

          <section className="space-y-3">
            <h3 className="athens-eyebrow">Posted date</h3>
            <div className="grid grid-cols-1 gap-3">
              <DatePicker
                label="From"
                value={parseDateStr(filters.postedFrom)}
                onChange={(d) => patch({ postedFrom: d ? format(d, "yyyy-MM-dd") : "" })}
                placeholder="Start date"
                tone="lens"
              />
              <DatePicker
                label="To"
                value={parseDateStr(filters.postedTo)}
                onChange={(d) => patch({ postedTo: d ? format(d, "yyyy-MM-dd") : "" })}
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
            onClick={() => onChange(clearAttributeFilters(filters))}
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
