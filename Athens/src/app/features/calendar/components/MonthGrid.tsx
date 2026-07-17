import React from "react";
import { cn } from "../../../lib/utils";
import { eventsByDay, EVENT_COLORS, formatTimeRange, type CalendarEvent } from "../../../data/calendar";

type MonthGridProps = {
  cur: Date;
  today: Date;
  events: CalendarEvent[];
  onEventClick: (e: CalendarEvent) => void;
};

export function MonthGrid({ cur, today, events, onEventClick }: MonthGridProps) {
  const dim = new Date(cur.getFullYear(), cur.getMonth() + 1, 0).getDate();
  const first = new Date(cur.getFullYear(), cur.getMonth(), 1).getDay();
  const byDay = eventsByDay(cur.getMonth(), cur.getFullYear(), events);

  return (
    <div className="flex-1 min-h-0 flex flex-col border border-border rounded-xl overflow-hidden shadow-sm bg-card">
      <div className="grid grid-cols-7 border-b border-border flex-shrink-0">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="py-3 text-center text-xs font-bold text-muted-foreground uppercase tracking-wider bg-secondary/30">
            {d}
          </div>
        ))}
      </div>
      <div className="flex-1 overflow-auto grid grid-cols-7 auto-rows-fr subtle-scroll">
        {Array.from({ length: first }).map((_, i) => (
          <div key={`e${i}`} className="border-r border-b border-border bg-secondary/20 min-h-[100px]" />
        ))}
        {Array.from({ length: dim }).map((_, i) => {
          const day = i + 1;
          const evts = byDay[day] || [];
          const isToday =
            day === today.getDate() &&
            cur.getMonth() === today.getMonth() &&
            cur.getFullYear() === today.getFullYear();
          return (
            <div key={day} className="border-r border-b border-border p-2 min-h-[100px] hover:bg-secondary/20 transition-colors">
              <span
                className={cn(
                  "inline-flex w-8 h-8 items-center justify-center rounded-full text-sm font-bold mb-1",
                  isToday ? "bg-primary text-white shadow-sm" : "text-muted-foreground",
                )}
              >
                {day}
              </span>
              <div className="space-y-1">
                {evts.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => onEventClick(e)}
                    className={cn(
                      "w-full text-left text-xs px-2 py-1 rounded font-semibold truncate border-l-2",
                      EVENT_COLORS[e.type],
                      !e.confirmed && "ring-1 ring-dashed ring-amber-400/50",
                    )}
                  >
                    {formatTimeRange(e.start, e.end).split("–")[0]} {e.title}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
