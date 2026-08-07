import React from "react";
import { VIEW_TITLES } from "../../config/navigation";
import { ThemeToggle } from "../shared/ThemeToggle";
import { display } from "../../lib/utils";
import type { View } from "../../types";

export function TopNav({ active }: { active: View }) {
  return (
    <header className="h-14 flex items-center px-6 border-b border-border bg-background/95 backdrop-blur-xl sticky top-0 z-20 flex-shrink-0">
      <div className="flex-1 flex items-center gap-3">
        <span className="text-base font-bold text-foreground" style={display}>
          {VIEW_TITLES[active]}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <ThemeToggle compact />
      </div>
    </header>
  );
}
