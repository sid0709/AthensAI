import React, { useEffect, useState } from "react";
import { Check, Clock } from "lucide-react";
import { TimePicker } from "../../../components/forms";
import { SlidePanel, SlidePanelHeader } from "../../../components/overlays";
import { cn } from "../../../lib/utils";
import { formatTimeRange, type CalendarEvent } from "../../../data/calendar";

type InterviewConfirmPanelProps = {
  event: CalendarEvent | null;
  onClose: () => void;
  onConfirm: (id: string, confirmed: boolean, times?: { start: string; end: string }) => void;
};

function toTimeValue(d: Date): string {
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }).slice(0, 5);
}

export function InterviewConfirmPanel({ event, onClose, onConfirm }: InterviewConfirmPanelProps) {
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");

  useEffect(() => {
    if (event) {
      setStartTime(toTimeValue(new Date(event.start)));
      setEndTime(toTimeValue(new Date(event.end)));
    }
  }, [event?.id]);

  return (
    <SlidePanel open={!!event} onOpenChange={(open) => !open && onClose()} width="md">
      {event && (
        <>
          <SlidePanelHeader title="Interview details" onClose={onClose} />
          <div className="flex-1 overflow-auto p-5 space-y-4 subtle-scroll">
            <div>
              <p className="text-lg font-bold text-foreground">{event.title}</p>
              {event.company && <p className="text-sm text-muted-foreground mt-1">{event.company}</p>}
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="w-4 h-4" />
              {formatTimeRange(event.start, event.end)}
            </div>
            <div
              className={cn(
                "rounded-xl px-4 py-3 text-sm font-semibold",
                event.confirmed ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-amber-500/10 text-amber-700 dark:text-amber-400",
              )}
            >
              {event.confirmed ? "Confirmed" : "Pending confirmation"}
            </div>
            <div className="space-y-3">
              <TimePicker label="Start time" value={startTime} onChange={setStartTime} />
              <TimePicker label="End time" value={endTime} onChange={setEndTime} />
            </div>
          </div>
          <div className="p-5 border-t border-border flex gap-2">
            <button
              type="button"
              onClick={() => onConfirm(event.id, true, { start: startTime, end: endTime })}
              className="flex-1 flex items-center justify-center gap-2 bg-primary text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-primary/90 min-h-10"
            >
              <Check className="w-4 h-4" />
              Confirm time
            </button>
            <button
              type="button"
              onClick={() => onConfirm(event.id, false)}
              className="px-4 py-2.5 rounded-xl text-sm font-semibold border border-border hover:bg-secondary min-h-10"
            >
              Mark pending
            </button>
          </div>
        </>
      )}
    </SlidePanel>
  );
}
