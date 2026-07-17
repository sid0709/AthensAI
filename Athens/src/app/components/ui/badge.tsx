import React from "react";
import { cn } from "../../lib/utils";
import type { BadgeVariant } from "../../types";

const BADGE_V: Record<BadgeVariant, string> = {
  default: "bg-secondary text-foreground/70 border border-border",
  success: "bg-emerald-50 text-emerald-700 border border-emerald-200",
  warn: "bg-amber-50 text-amber-700 border border-amber-200",
  err: "bg-rose-50 text-rose-700 border border-rose-200",
  violet: "bg-violet-50 text-violet-700 border border-violet-200",
  blue: "bg-blue-50 text-blue-700 border border-blue-200",
  subtle: "bg-muted text-muted-foreground border border-border",
  amber: "bg-amber-50 text-amber-700 border border-amber-200",
  pink: "bg-pink-50 text-pink-700 border border-pink-200",
};

export function Badge({
  children,
  v = "default",
}: {
  children: React.ReactNode;
  v?: BadgeVariant;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-semibold tracking-wide capitalize",
        BADGE_V[v]
      )}
    >
      {children}
    </span>
  );
}
