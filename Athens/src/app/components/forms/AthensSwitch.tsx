"use client";

import React from "react";
import { cn } from "../../lib/utils";
import { Switch } from "../ui/switch";

type AthensSwitchProps = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
  className?: string;
};

export function AthensSwitch({
  checked,
  onCheckedChange,
  label,
  description,
  disabled,
  className,
}: AthensSwitchProps) {
  return (
    <div className={cn("flex items-center justify-between gap-4", className)}>
      {(label || description) && (
        <div className="min-w-0">
          {label && <p className="text-sm font-semibold text-foreground">{label}</p>}
          {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
        </div>
      )}
      <Switch checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </div>
  );
}
