import React from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Pill } from "../../../components/ui";

type CalendarView = "month" | "week" | "pipeline";

type CalendarHeaderProps = {
  label: string;
  view: CalendarView;
  onViewChange: (v: CalendarView) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onAddEvent?: () => void;
};

export function CalendarHeader({
  label,
  view,
  onViewChange,
  onPrev,
  onNext,
  onToday,
  onAddEvent,
}: CalendarHeaderProps) {
  return (
    <div className="flex items-center justify-between mb-4 flex-shrink-0 flex-wrap gap-3">
      <h2 className="text-xl font-bold text-foreground">{label}</h2>
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1 bg-secondary rounded-xl p-1">
          <Pill active={view === "month"} onClick={() => onViewChange("month")}>
            Month
          </Pill>
          <Pill active={view === "week"} onClick={() => onViewChange("week")}>
            Week
          </Pill>
          <Pill active={view === "pipeline"} onClick={() => onViewChange("pipeline")}>
            Pipeline
          </Pill>
        </div>
        {view !== "pipeline" && (
          <>
            <button type="button" onClick={onPrev} className="icon-btn text-muted-foreground hover:text-foreground hover:bg-secondary border border-border">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button type="button" onClick={onToday} className="px-4 py-2 text-sm font-bold text-muted-foreground hover:text-foreground hover:bg-secondary rounded-xl min-h-10">
              Today
            </button>
            <button type="button" onClick={onNext} className="icon-btn text-muted-foreground hover:text-foreground hover:bg-secondary border border-border">
              <ChevronRight className="w-5 h-5" />
            </button>
          </>
        )}
        <button
          type="button"
          onClick={onAddEvent}
          className="flex items-center gap-2 bg-primary text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-primary/90 min-h-10"
        >
          <Plus className="w-4 h-4" />
          Add Event
        </button>
      </div>
    </div>
  );
}
