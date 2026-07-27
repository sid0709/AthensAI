import React from "react";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { Pill } from "../../../components/ui";

type CalendarView = "month" | "week";

type CalendarHeaderProps = {
  label: string;
  view: CalendarView;
  onViewChange: (v: CalendarView) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
};

export function CalendarHeader({
  label,
  view,
  onViewChange,
  onPrev,
  onNext,
  onToday,
  onRefresh,
  refreshing,
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
        </div>
        <button type="button" onClick={onPrev} className="icon-btn text-muted-foreground hover:text-foreground hover:bg-secondary border border-border">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <button type="button" onClick={onToday} className="px-4 py-2 text-sm font-bold text-muted-foreground hover:text-foreground hover:bg-secondary rounded-xl min-h-10">
          Today
        </button>
        <button type="button" onClick={onNext} className="icon-btn text-muted-foreground hover:text-foreground hover:bg-secondary border border-border">
          <ChevronRight className="w-5 h-5" />
        </button>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="flex items-center gap-2 border border-border px-3 py-2.5 rounded-xl text-sm font-bold hover:bg-secondary min-h-10 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>
    </div>
  );
}
