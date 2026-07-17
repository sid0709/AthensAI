import React, { useEffect, useState } from "react";
import { Clock, Video, AlertCircle } from "lucide-react";
import { Badge } from "../../../components/ui";
import { cn, display } from "../../../lib/utils";
import { formatTimeRange, type CalendarEvent } from "../../../data/calendar";

type PrepContextSidebarProps = {
  upcoming: CalendarEvent[];
  onSelectInterview: (e: CalendarEvent) => void;
  selectedId?: string;
};

export function PrepContextSidebar({ upcoming, onSelectInterview, selectedId }: PrepContextSidebarProps) {
  const [now, setNow] = useState(new Date("2026-06-18T09:30:00"));

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(id);
  }, []);

  const inProgress = upcoming.find((e) => {
    const s = new Date(e.start);
    const end = new Date(e.end);
    return now >= s && now <= end;
  });

  return (
    <aside className="w-72 border-r border-border flex flex-col flex-shrink-0 bg-card/40">
      <div className="p-5 border-b border-border">
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">Current time</p>
        <p className="text-2xl font-bold text-foreground tabular-nums" style={display}>
          {now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
        </p>
        <p className="text-sm text-muted-foreground mt-0.5">
          {now.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
        </p>
      </div>
      {inProgress && (
        <div className="mx-4 mt-4 rounded-xl bg-violet-500/10 border border-violet-500/20 p-4">
          <div className="flex items-center gap-2 text-violet-700 dark:text-violet-300 font-bold text-sm mb-1">
            <AlertCircle className="w-4 h-4" />
            In progress
          </div>
          <p className="text-sm font-semibold text-foreground">{inProgress.title}</p>
          <p className="text-xs text-muted-foreground mt-1">{inProgress.company}</p>
        </div>
      )}
      <div className="flex-1 overflow-auto p-4 subtle-scroll">
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <Video className="w-3.5 h-3.5" />
          Upcoming interviews
        </p>
        <div className="space-y-2">
          {upcoming.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => onSelectInterview(e)}
              className={cn(
                "w-full text-left rounded-xl border p-3 transition-colors",
                selectedId === e.id
                  ? "border-primary bg-primary/5"
                  : "border-border hover:bg-secondary/50",
              )}
            >
              <p className="text-sm font-bold text-foreground truncate">{e.title}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{e.company}</p>
              <div className="flex items-center gap-1.5 mt-2 text-xs text-muted-foreground">
                <Clock className="w-3 h-3" />
                {formatTimeRange(e.start, e.end)}
              </div>
              <Badge v={e.confirmed ? "success" : "warn"}>{e.confirmed ? "Confirmed" : "Pending"}</Badge>
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}
