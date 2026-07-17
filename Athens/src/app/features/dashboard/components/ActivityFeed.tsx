import React from "react";
import { cn } from "../../../lib/utils";
import { ACTIVITIES } from "../../../data/dashboard";

export function ActivityFeed() {
  return (
    <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
      <h3 className="text-sm font-bold text-foreground mb-5">Activity Feed</h3>
      <div className="space-y-4">
        {ACTIVITIES.map((a, i) => (
          <div key={i} className="flex gap-3 items-start">
            <a.icon className={cn("w-5 h-5 mt-0.5 flex-shrink-0", a.c)} />
            <div>
              <p className="text-sm text-foreground/85 leading-relaxed">{a.t}</p>
              <p className="text-xs text-muted-foreground mt-1">{a.ts}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
