import React from "react";
import { Tags } from "lucide-react";
import { Button } from "../../../../components/ui/button";
import { Checkbox } from "../../../../components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "../../../../components/ui/popover";
import { cn } from "../../../../lib/utils";
import { JOB_TITLE_SCAN_ROLE_OPTIONS } from "../../../../data/jobTitleRoles";
import { toggleMultiSelectValue } from "../../../../components/forms/AthensMultiSelect";
import type { JobSearchFilterState } from "../../../../hooks/useJobSearchFilters";

type JobTitleRoleFilterPopoverProps = {
  filters: JobSearchFilterState;
  onChange: (filters: JobSearchFilterState) => void;
};

export function JobTitleRoleFilterPopover({ filters, onChange }: JobTitleRoleFilterPopoverProps) {
  const selected = filters.titleRoles;
  const count = selected.length;
  const allSelected = count === JOB_TITLE_SCAN_ROLE_OPTIONS.length;

  const setRoles = (titleRoles: string[]) => onChange({ ...filters, titleRoles });

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 gap-1.5 shrink-0">
          <Tags className="w-4 h-4" />
          Role
          {count > 0 && (
            <span className="ml-0.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold">
              {count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
          <div>
            <p className="text-xs font-semibold text-foreground">Title role</p>
            <p className="text-[11px] text-muted-foreground">Multi-select · AI title scan</p>
          </div>
          {count > 0 ? (
            <button
              type="button"
              onClick={() => setRoles([])}
              className="text-[11px] font-semibold text-primary hover:underline"
            >
              Clear
            </button>
          ) : null}
        </div>
        <div className="p-2 space-y-0.5">
          <label className="flex items-center gap-2.5 rounded-md px-2 py-1.5 cursor-pointer hover:bg-secondary/80 transition-colors">
            <Checkbox
              checked={allSelected}
              onCheckedChange={(checked) =>
                setRoles(checked ? JOB_TITLE_SCAN_ROLE_OPTIONS.map((o) => o.value) : [])
              }
            />
            <span className="text-sm font-medium text-foreground">Select all</span>
          </label>
          <div className="h-px bg-border/60 my-1" />
          {JOB_TITLE_SCAN_ROLE_OPTIONS.map((opt) => {
            const checked = selected.includes(opt.value);
            return (
              <label
                key={opt.value}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-2 py-1.5 cursor-pointer hover:bg-secondary/80 transition-colors",
                )}
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={() => setRoles(toggleMultiSelectValue(selected, opt.value))}
                />
                <span className="text-sm text-foreground">{opt.label}</span>
              </label>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
