import React from "react";
import { cn } from "../../../lib/utils";
import { CALENDAR_EVENTS } from "../../../data/calendar";

export function MiniCalendarStrip({ onNavigate }: { onNavigate?: () => void }) {
  const today = 18;
  const month = "June 2026";
  const days = Array.from({ length: 14 }, (_, i) => i + 15);

  const hasEvent = (day: number) =>
    CALENDAR_EVENTS.some((e) => new Date(e.start).getDate() === day && new Date(e.start).getMonth() === 5);

  return (
    <button
      type="button"
      onClick={onNavigate}
      className="w-full bg-card border border-border rounded-xl p-4 shadow-sm text-left hover:shadow-md transition-shadow"
    >
      <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">{month}</p>
      <div className="flex gap-1.5 overflow-x-auto scroll-row pb-1">
        {days.map((d) => (
          <div
            key={d}
            className={cn(
              "flex flex-col items-center min-w-[40px] py-2 rounded-lg",
              d === today ? "bg-primary text-white" : "text-muted-foreground",
              hasEvent(d) && d !== today && "ring-1 ring-primary/30",
            )}
          >
            <span className="text-[10px] font-semibold uppercase">
              {new Date(2026, 5, d).toLocaleDateString("en-US", { weekday: "narrow" })}
            </span>
            <span className="text-sm font-bold mt-0.5">{d}</span>
            {hasEvent(d) && <span className={cn("w-1 h-1 rounded-full mt-1", d === today ? "bg-white" : "bg-primary")} />}
          </div>
        ))}
      </div>
    </button>
  );
}
