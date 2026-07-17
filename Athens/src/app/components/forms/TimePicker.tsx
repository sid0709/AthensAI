"use client";

import React, { useMemo } from "react";
import { Clock } from "lucide-react";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { FormField } from "./FormField";
import { athensInputClass } from "./formTokens";

const TIMES = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2);
  const m = i % 2 === 0 ? "00" : "30";
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  const ampm = h < 12 ? "AM" : "PM";
  const value = `${String(h).padStart(2, "0")}:${m}`;
  const label = `${hour12}:${m} ${ampm}`;
  return { value, label };
});

type TimePickerProps = {
  label?: string;
  hint?: string;
  error?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
};

export function TimePicker({
  label,
  hint,
  error,
  value,
  onChange,
  placeholder = "Select time",
  className,
  disabled,
}: TimePickerProps) {
  const display = useMemo(() => {
    if (!value) return placeholder;
    return TIMES.find((t) => t.value === value)?.label ?? value;
  }, [value, placeholder]);

  return (
    <FormField label={label} hint={hint} error={error} className={className}>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            className={cn(
              athensInputClass,
              "justify-start text-left font-normal h-auto",
              !value && "text-muted-foreground",
            )}
          >
            <Clock className="mr-2 h-4 w-4 shrink-0 opacity-60" />
            {display}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-48 p-1 rounded-xl max-h-60 overflow-y-auto" align="start">
          {TIMES.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => onChange(t.value)}
              className={cn(
                "w-full text-left px-3 py-2 text-sm rounded-lg transition-colors",
                value === t.value
                  ? "bg-primary/10 text-primary font-semibold"
                  : "hover:bg-secondary text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </PopoverContent>
      </Popover>
    </FormField>
  );
}
