import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router";
import { useApplier } from "@/context/applier-context";
import { CalendarHeader } from "./components/CalendarHeader";
import { MonthGrid } from "./components/MonthGrid";
import { WeekTimeGrid } from "./components/WeekTimeGrid";
import { DEFAULT_TABS, normalizeTab, PATHS, type CalendarTab } from "../../config/routes";
import { eventsInWeek, type CalendarEvent } from "../../data/calendar";
import { fetchNotionCalendar } from "../../services/notionApi";

function startOfWeek(date: Date): Date {
  const result = new Date(date);
  result.setDate(result.getDate() - result.getDay());
  result.setHours(0, 0, 0, 0);
  return result;
}

function rangeFor(view: CalendarTab, cursor: Date) {
  if (view === "month") {
    return {
      start: new Date(cursor.getFullYear(), cursor.getMonth(), 1),
      end: new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1),
    };
  }
  const start = startOfWeek(cursor);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { start, end };
}

const VIEWS = ["month", "week"] as const satisfies readonly CalendarTab[];

export function CalendarPage() {
  const { applier } = useApplier();
  const { view: viewParam } = useParams<{ view?: string }>();
  const navigate = useNavigate();
  const view = normalizeTab(viewParam, VIEWS, DEFAULT_TABS.calendar);
  const setView = useCallback((next: CalendarTab) => navigate(`${PATHS.calendar}/${next}`), [navigate]);
  const today = useMemo(() => new Date(), []);
  const [cursor, setCursor] = useState(() => new Date());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [disconnected, setDisconnected] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const range = useMemo(() => rangeFor(view, cursor), [cursor, view]);
  const weekStart = useMemo(() => startOfWeek(cursor), [cursor]);

  useEffect(() => {
    if (!applier?.name) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDisconnected(false);
    void fetchNotionCalendar(applier.name, range.start.toISOString(), range.end.toISOString())
      .then((data) => {
        if (!cancelled) setEvents(data.events);
      })
      .catch((loadError) => {
        if (cancelled) return;
        const typed = loadError as Error & { status?: number; code?: string };
        if (typed.status === 409 || typed.code === "not_connected") {
          setDisconnected(true);
          setEvents([]);
        } else {
          setError(typed.message || "Could not load Call Record");
        }
      })
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [applier?.name, range.start.getTime(), range.end.getTime(), refreshKey]);

  const label = view === "month"
    ? cursor.toLocaleDateString("en-US", { month: "long", year: "numeric" })
    : `${weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${new Date(weekStart.getTime() + 6 * 86400000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

  const openEvent = (event: CalendarEvent) => {
    if (event.notionUrl) window.open(event.notionUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="relative flex h-full flex-col overflow-hidden p-6">
      <CalendarHeader
        label={label}
        view={view}
        onViewChange={setView}
        onPrev={() => setCursor(view === "month" ? new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1) : new Date(cursor.getTime() - 7 * 86400000))}
        onNext={() => setCursor(view === "month" ? new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1) : new Date(cursor.getTime() + 7 * 86400000))}
        onToday={() => setCursor(new Date())}
        onRefresh={() => setRefreshKey((key) => key + 1)}
        refreshing={loading}
      />

      {view === "month" ? (
        <MonthGrid cur={cursor} today={today} events={events} onEventClick={openEvent} />
      ) : (
        <WeekTimeGrid weekStart={weekStart} events={eventsInWeek(weekStart, events)} today={today} onEventClick={openEvent} />
      )}

      {loading && (
        <div className="pointer-events-none absolute inset-0 top-20 flex items-center justify-center bg-background/55 backdrop-blur-[1px]">
          <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm font-semibold shadow-lg"><Loader2 className="h-4 w-4 animate-spin" /> Loading Call Record…</div>
        </div>
      )}
      {!loading && disconnected && (
        <div className="absolute inset-0 top-20 flex items-center justify-center bg-background/80">
          <div className="max-w-sm rounded-xl border border-border bg-card p-6 text-center shadow-lg">
            <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-secondary font-black">N</div>
            <h2 className="font-bold">Connect Notion to populate Calendar</h2>
            <p className="mt-1 text-sm text-muted-foreground">Calendar reads live entries from the shared Call Record data source.</p>
            <Link to={`${PATHS.settings}/integrations`} className="mt-4 inline-flex min-h-10 items-center rounded-xl bg-primary px-4 py-2 text-sm font-bold text-white">Open integrations</Link>
          </div>
        </div>
      )}
      {!loading && error && (
        <div className="absolute inset-x-6 top-24 z-10 flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 shadow-sm dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          <AlertCircle className="h-5 w-5 flex-shrink-0" /><span className="flex-1">{error}</span>
          <button type="button" onClick={() => setRefreshKey((key) => key + 1)} className="font-bold underline">Retry</button>
        </div>
      )}
      {!loading && !error && !disconnected && events.length === 0 && (
        <div className="pointer-events-none absolute inset-0 top-20 flex items-center justify-center">
          <p className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground shadow-sm">No Call Record entries in this date range.</p>
        </div>
      )}
    </div>
  );
}
