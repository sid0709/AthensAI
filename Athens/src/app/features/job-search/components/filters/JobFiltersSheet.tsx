import React from "react";
import { format, parseISO, isValid } from "date-fns";
import { Button } from "../../../../components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "../../../../components/ui/sheet";
import { AthensSelect, AthensMultiSelect, DatePicker } from "../../../../components/forms";
import {
  JOB_INDUSTRIES,
  JOB_LOCATIONS,
  JOB_SENIORITIES,
  JOB_WORK_MODES,
} from "../../../../data/jobs";
import { JOB_TITLE_SCAN_ROLE_OPTIONS } from "../../../../data/jobTitleRoles";
import { JobSourceTitles } from "../../../../data/jobs/pub";
import type { JobSearchFilterState } from "../../../../hooks/useJobSearchFilters";
import { clearAttributeFilters } from "../../../../hooks/useJobSearchFilters";

type JobFiltersSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: JobSearchFilterState;
  onChange: (filters: JobSearchFilterState) => void;
  /** AI title-role multi-select — beta tier only. */
  showTitleRoleFilter?: boolean;
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

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
  showTitleRoleFilter = false,
}: JobFiltersSheetProps) {
  const patch = (partial: Partial<JobSearchFilterState>) => onChange({ ...filters, ...partial });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Attribute filters</SheetTitle>
          <SheetDescription>Source, location, dates, and role attributes.</SheetDescription>
        </SheetHeader>

        <div className="px-4 space-y-6 pb-4">
          <Section title="Source">
            <AthensMultiSelect
              label="Job source"
              values={filters.source}
              onChange={(source) => patch({ source })}
              placeholder="All sources"
              options={JobSourceTitles.map((s) => ({ value: s, label: s }))}
              maxHeightClassName="max-h-56"
            />
          </Section>

          <Section title="Posted date">
            <div className="grid grid-cols-1 gap-3">
              <DatePicker
                label="From"
                value={parseDateStr(filters.postedFrom)}
                onChange={(d) => patch({ postedFrom: d ? format(d, "yyyy-MM-dd") : "" })}
                placeholder="Start date"
              />
              <DatePicker
                label="To"
                value={parseDateStr(filters.postedTo)}
                onChange={(d) => patch({ postedTo: d ? format(d, "yyyy-MM-dd") : "" })}
                placeholder="End date"
              />
            </div>
          </Section>

          <Section title="Location & mode">
            <div className="grid grid-cols-1 gap-3">
              <AthensSelect
                label="Location"
                value={filters.location}
                onChange={(location) => patch({ location })}
                options={JOB_LOCATIONS.map((l) => ({
                  value: l,
                  label: l === "all" ? "Any location" : l,
                }))}
              />
              <AthensSelect
                label="Work mode"
                value={filters.workMode}
                onChange={(workMode) => patch({ workMode })}
                options={JOB_WORK_MODES.map((m) => ({
                  value: m,
                  label: m === "all" ? "Any mode" : m.charAt(0).toUpperCase() + m.slice(1),
                }))}
              />
            </div>
          </Section>

          <Section title="Role attributes">
            <div className="grid grid-cols-1 gap-3">
              {showTitleRoleFilter ? (
                <AthensMultiSelect
                  label="Title role (AI)"
                  values={filters.titleRoles}
                  onChange={(titleRoles) => patch({ titleRoles })}
                  placeholder="All title roles"
                  options={JOB_TITLE_SCAN_ROLE_OPTIONS.map((o) => ({
                    value: o.value,
                    label: o.label,
                  }))}
                  hint="From Analyze title — checkbox multi-select"
                />
              ) : null}
              <AthensMultiSelect
                label="Seniority"
                values={filters.seniority}
                onChange={(seniority) => patch({ seniority })}
                placeholder="All levels"
                options={JOB_SENIORITIES.filter((s) => s !== "all").map((s) => ({
                  value: s,
                  label: s,
                }))}
              />
              <AthensSelect
                label="Industry"
                value={filters.industry}
                onChange={(industry) => patch({ industry })}
                options={JOB_INDUSTRIES.map((i) => ({
                  value: i,
                  label: i === "all" ? "All industries" : i,
                }))}
              />
            </div>
          </Section>
        </div>

        <SheetFooter className="flex-row gap-2 border-t border-border">
          <Button variant="outline" className="flex-1" onClick={() => onChange(clearAttributeFilters(filters))}>
            Reset section
          </Button>
          <Button className="flex-1" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
