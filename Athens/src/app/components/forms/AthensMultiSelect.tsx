"use client";

import React from "react";
import { cn } from "../../lib/utils";
import { Checkbox } from "../ui/checkbox";
import { FormField } from "./FormField";

export type AthensMultiSelectOption = { value: string; label: string };

type AthensMultiSelectProps = {
  label?: string;
  hint?: string;
  error?: string;
  values: string[];
  onChange: (values: string[]) => void;
  options: AthensMultiSelectOption[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  maxHeightClassName?: string;
};

export function toggleMultiSelectValue(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
}

export function AthensMultiSelect({
  label,
  hint,
  error,
  values,
  onChange,
  options,
  placeholder = "Any",
  className,
  disabled,
  maxHeightClassName = "max-h-48",
}: AthensMultiSelectProps) {
  const selectedLabels = options
    .filter((opt) => values.includes(opt.value))
    .map((opt) => opt.label);

  return (
    <FormField label={label} hint={hint} error={error} className={className}>
      <div className="rounded-lg border border-border bg-secondary/40 overflow-hidden">
        <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
          <span className="text-xs text-muted-foreground truncate">
            {selectedLabels.length
              ? `${selectedLabels.length} selected`
              : placeholder}
          </span>
          {values.length > 0 ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange([])}
              className="text-[11px] font-semibold text-primary hover:underline disabled:opacity-50"
            >
              Clear
            </button>
          ) : null}
        </div>
        <div className={cn("overflow-y-auto subtle-scroll p-2 space-y-0.5", maxHeightClassName)}>
          {options.map((opt) => {
            const checked = values.includes(opt.value);
            return (
              <label
                key={opt.value}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-2 py-1.5 cursor-pointer hover:bg-secondary/80 transition-colors",
                  disabled && "opacity-50 cursor-not-allowed",
                )}
              >
                <Checkbox
                  checked={checked}
                  disabled={disabled}
                  onCheckedChange={() => onChange(toggleMultiSelectValue(values, opt.value))}
                />
                <span className="text-sm text-foreground">{opt.label}</span>
              </label>
            );
          })}
        </div>
      </div>
    </FormField>
  );
}
