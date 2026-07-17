import React from "react";
import { Clock, Video } from "lucide-react";
import { Badge } from "../../../components/ui";
import { formatTimeRange, type CalendarEvent } from "../../../data/calendar";

type UpcomingInterviewsPanelProps = {
  interviews: CalendarEvent[];
  onNavigatePrep?: () => void;
};

export function UpcomingInterviewsPanel({ interviews, onNavigatePrep }: UpcomingInterviewsPanelProps) {
  return (
    <div className="bg-card border border-border rounded-xl p-5 shadow-sm h-full">
      <div className="flex items-center gap-2 mb-4">
        <Video className="w-5 h-5 text-primary" />
        <h3 className="text-sm font-bold text-foreground">Upcoming Interviews</h3>
      </div>
      <div className="space-y-3">
        {interviews.length === 0 ? (
          <p className="text-sm text-muted-foreground">No upcoming interviews scheduled.</p>
        ) : (
          interviews.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={onNavigatePrep}
              className="w-full flex items-start gap-3 p-3 rounded-xl bg-secondary/40 border border-border/50 hover:bg-secondary/70 transition-colors text-left"
            >
              <div className="w-10 h-10 rounded-lg bg-violet-500/10 flex items-center justify-center text-violet-600 font-bold text-sm flex-shrink-0">
                {e.company?.[0] ?? "I"}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-foreground truncate">{e.title}</p>
                <p className="text-xs text-muted-foreground">{e.company}</p>
                <div className="flex items-center gap-1.5 mt-1.5 text-xs text-muted-foreground">
                  <Clock className="w-3 h-3" />
                  {new Date(e.start).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · {formatTimeRange(e.start, e.end)}
                </div>
              </div>
              <Badge v={e.confirmed ? "success" : "warn"}>{e.confirmed ? "Confirmed" : "Pending"}</Badge>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
