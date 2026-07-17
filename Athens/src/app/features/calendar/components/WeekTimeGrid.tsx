import React from "react";
import { Check } from "lucide-react";
import { cn } from "../../../lib/utils";
import { EVENT_COLORS, formatTimeRange, type CalendarEvent } from "../../../data/calendar";

const HOURS = Array.from({ length: 16 }, (_, i) => i + 5);

type EventBlockProps = {
  event: CalendarEvent;
  dayIndex: number;
  weekStart: Date;
  onClick: () => void;
};

function eventLayout(event: CalendarEvent, weekStart: Date) {
  const start = new Date(event.start);
  const end = new Date(event.end);
  const dayIdx = Math.floor((start.getTime() - weekStart.getTime()) / 86400000);
  const topMin = (start.getHours() - 5) * 60 + start.getMinutes();
  const durMin = Math.max(30, (end.getTime() - start.getTime()) / 60000);
  return { dayIdx, top: (topMin / 60) * 48, height: (durMin / 60) * 48 };
}

export function EventBlock({ event, dayIndex, weekStart, onClick }: EventBlockProps) {
  const { dayIdx, top, height } = eventLayout(event, weekStart);
  if (dayIdx !== dayIndex) return null;

  return (
    <button
      type="button"
      onClick={onClick}
      style={{ top: `${top}px`, height: `${Math.max(height, 24)}px` }}
      className={cn(
        "absolute left-0.5 right-0.5 rounded-md px-1.5 py-0.5 text-left text-xs font-semibold border-l-2 overflow-hidden z-10",
        EVENT_COLORS[event.type],
        !event.confirmed && "border-dashed border-amber-400",
      )}
    >
      <span className="block truncate">{event.title}</span>
      <span className="block text-[10px] opacity-80 truncate">{formatTimeRange(event.start, event.end)}</span>
      {event.confirmed && <Check className="w-3 h-3 absolute top-1 right-1 text-emerald-600" />}
    </button>
  );
}

type WeekTimeGridProps = {
  weekStart: Date;
  events: CalendarEvent[];
  today: Date;
  onEventClick: (e: CalendarEvent) => void;
};

export function WeekTimeGrid({ weekStart, events, today, onEventClick }: WeekTimeGridProps) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });

  return (
    <div className="flex-1 min-h-0 flex flex-col border border-border rounded-xl overflow-hidden shadow-sm bg-card">
      <div className="grid grid-cols-[48px_repeat(7,1fr)] border-b border-border flex-shrink-0">
        <div className="py-2 text-xs text-muted-foreground text-center">CDT</div>
        {days.map((d) => {
          const isToday = d.toDateString() === today.toDateString();
          return (
            <div key={d.toISOString()} className="py-2 text-center border-l border-border">
              <span className="text-xs text-muted-foreground block">
                {d.toLocaleDateString("en-US", { weekday: "short" })}
              </span>
              <span
                className={cn(
                  "inline-flex w-7 h-7 items-center justify-center rounded-full text-sm font-bold mt-0.5",
                  isToday ? "bg-primary text-white" : "text-foreground",
                )}
              >
                {d.getDate()}
              </span>
            </div>
          );
        })}
      </div>
      <div className="flex-1 overflow-auto subtle-scroll">
        <div className="grid grid-cols-[48px_repeat(7,1fr)] min-h-[768px]">
          <div className="relative">
            {HOURS.map((h) => (
              <div key={h} className="h-12 text-[10px] text-muted-foreground text-right pr-2 -mt-2">
                {String(h).padStart(2, "0")}:00
              </div>
            ))}
          </div>
          {days.map((d, dayIndex) => (
            <div key={d.toISOString()} className="relative border-l border-border">
              {HOURS.map((h) => (
                <div key={h} className="h-12 border-b border-border/50" />
              ))}
              {events.map((e) => (
                <EventBlock
                  key={e.id}
                  event={e}
                  dayIndex={dayIndex}
                  weekStart={weekStart}
                  onClick={() => onEventClick(e)}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
