import React from "react";
import { cn } from "../../lib/utils";

export function Pill({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-4 py-2 rounded-lg text-sm font-semibold transition-all min-h-10 capitalize",
        active
          ? "bg-card text-foreground shadow-sm border border-border"
          : "text-muted-foreground hover:text-foreground hover:bg-secondary"
      )}
    >
      {children}
    </button>
  );
}
