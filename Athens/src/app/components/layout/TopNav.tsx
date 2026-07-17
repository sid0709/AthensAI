import React from "react";
import { Search, Bell, Sparkles } from "lucide-react";
import { VIEW_TITLES } from "../../config/navigation";
import { Badge } from "../ui";
import { ThemeToggle } from "../shared/ThemeToggle";
import { display, mono } from "../../lib/utils";
import type { View } from "../../types";

export function TopNav({ active }: { active: View }) {
  return (
    <header className="h-14 flex items-center px-6 border-b border-border bg-background/95 backdrop-blur-xl sticky top-0 z-20 flex-shrink-0">
      <div className="flex-1 flex items-center gap-3">
        <span className="text-base font-bold text-foreground" style={display}>
          {VIEW_TITLES[active]}
        </span>
        {active === "ats" && <Badge v="violet">Live</Badge>}
        {active === "copilot" && <Badge v="violet">AI Active</Badge>}
      </div>
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 bg-secondary border border-border rounded-xl px-4 py-2 w-56 hover:border-primary/30 transition-colors cursor-text min-h-10">
          <Search className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground flex-1">Search...</span>
          <kbd className="text-xs text-muted-foreground/60 bg-card px-2 py-0.5 rounded border border-border" style={mono}>
            ⌘K
          </kbd>
        </div>
        <button type="button" className="flex items-center gap-2 bg-primary/10 hover:bg-primary/15 border border-primary/20 text-primary px-4 py-2 rounded-xl text-sm font-bold transition-colors min-h-10">
          <Sparkles className="w-4 h-4" />
          AI
        </button>
        <ThemeToggle compact />
        <button type="button" className="relative icon-btn text-muted-foreground hover:text-foreground hover:bg-secondary">
          <Bell className="w-5 h-5" />
          <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-primary" />
        </button>
      </div>
    </header>
  );
}
