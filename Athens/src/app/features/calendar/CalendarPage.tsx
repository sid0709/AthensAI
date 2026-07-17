import React, { useCallback, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { CalendarHeader } from "./components/CalendarHeader";
import { MonthGrid } from "./components/MonthGrid";
import { WeekTimeGrid } from "./components/WeekTimeGrid";
import { EventFormPanel } from "./components/EventFormPanel";
import { InterviewPipelineTab } from "./components/InterviewPipelineTab";
import { DEFAULT_TABS, normalizeTab, PATHS, type CalendarTab } from "../../config/routes";
import { CALENDAR_EVENTS, eventsInWeek, type CalendarEvent } from "../../data/calendar";

function startOfWeek(d: Date): Date {
  const r = new Date(d);
  r.setDate(r.getDate() - r.getDay());
  r.setHours(0, 0, 0, 0);
  return r;
}

const VIEWS = ["month", "week", "pipeline"] as const satisfies readonly CalendarTab[];

type PanelMode = "create" | "edit" | null;

export function CalendarPage() {
  const { view: viewParam } = useParams<{ view?: string }>();
  const navigate = useNavigate();
  const view = normalizeTab(viewParam, VIEWS, DEFAULT_TABS.calendar);
  const setView = useCallback(
    (v: CalendarTab) => navigate(`${PATHS.calendar}/${v}`),
    [navigate],
  );

  const today = useMemo(() => new Date(2026, 5, 18), []);
  const [cur, setCur] = useState(new Date(2026, 5, 1));
  const [events, setEvents] = useState(CALENDAR_EVENTS);
  const [selected, setSelected] = useState<CalendarEvent | null>(null);
  const [panelMode, setPanelMode] = useState<PanelMode>(null);

  const weekStart = startOfWeek(view === "week" ? cur : today);
  const label =
    view === "pipeline"
      ? "Interview pipeline"
      : view === "month"
        ? cur.toLocaleDateString("en-US", { month: "long", year: "numeric" })
        : `${weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${new Date(weekStart.getTime() + 6 * 86400000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

  const weekEvents = eventsInWeek(weekStart, events);

  const openCreate = () => {
    setSelected(null);
    setPanelMode("create");
  };

  const openEdit = (event: CalendarEvent) => {
    setSelected(event);
    setPanelMode("edit");
  };

  const closePanel = () => {
    setPanelMode(null);
    setSelected(null);
  };

  const handleSave = (event: CalendarEvent) => {
    setEvents((prev) => {
      const exists = prev.some((e) => e.id === event.id);
      return exists ? prev.map((e) => (e.id === event.id ? event : e)) : [...prev, event];
    });
  };

  const handleDelete = (id: string) => {
    setEvents((prev) => prev.filter((e) => e.id !== id));
  };

  return (
    <div className="h-full flex flex-col p-6 overflow-hidden relative">
      <CalendarHeader
        label={label}
        view={view}
        onViewChange={setView}
        onPrev={() =>
          setCur(
            view === "month"
              ? new Date(cur.getFullYear(), cur.getMonth() - 1, 1)
              : new Date(cur.getTime() - 7 * 86400000),
          )
        }
        onNext={() =>
          setCur(
            view === "month"
              ? new Date(cur.getFullYear(), cur.getMonth() + 1, 1)
              : new Date(cur.getTime() + 7 * 86400000),
          )
        }
        onToday={() => setCur(new Date(today))}
        onAddEvent={openCreate}
      />

      {view === "month" && (
        <MonthGrid cur={cur} today={today} events={events} onEventClick={openEdit} />
      )}
      {view === "week" && (
        <WeekTimeGrid weekStart={weekStart} events={weekEvents} today={today} onEventClick={openEdit} />
      )}
      {view === "pipeline" && <InterviewPipelineTab events={events} />}

      <EventFormPanel
        open={panelMode !== null}
        mode={panelMode === "create" ? "create" : "edit"}
        event={panelMode === "edit" ? selected : null}
        onClose={closePanel}
        onSave={handleSave}
        onDelete={handleDelete}
      />
    </div>
  );
}
