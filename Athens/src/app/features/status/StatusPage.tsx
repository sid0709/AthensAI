import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock3, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import { API_BASE } from "@/lib/api-base";
import { LiveMetricsPanel, type LiveMetricPoint, type LiveRange, type TodayHealthSegment, type VpsAvailabilityPoint } from "./LiveMetricsPanel";

type StatusValue = "operational" | "degraded" | "partial_outage" | "major_outage" | "maintenance" | "unknown";
type ComponentStatus = { component: string; name: string; status: StatusValue; message: string; lastCheckedAt: string | null; lastSuccessAt: string | null; latencyMs: number | null; uptimePercent: number | null };
type CurrentResponse = { status: StatusValue; updatedAt: string | null; components: ComponentStatus[] };
type Rollup = { date: string; component: string; name: string; availabilityPercent: number; avgLatencyMs: number | null; maxLatencyMs: number | null; sampleCount: number };
type Incident = { component: string; name: string; status: StatusValue; severity: string; title: string; description: string; startedAt: string; resolvedAt: string | null };
type LiveResponse = { updatedAt: string | null; points: LiveMetricPoint[] };
type TodayComponent = { component: string; name: string; segments: TodayHealthSegment[] };
type TodayResponse = { startAt: string; endAt: string; bucketMinutes: number; components: TodayComponent[] };
type HistoryState = "up" | "degraded" | "down" | "no_data";

const statusCopy: Record<StatusValue, string> = {
  operational: "All systems operational",
  degraded: "Some systems are degraded",
  partial_outage: "Partial system outage",
  major_outage: "Major system outage",
  maintenance: "Maintenance in progress",
  unknown: "Status signal unavailable",
};

const historyStyle: Record<HistoryState, { label: string; className: string; style?: React.CSSProperties }> = {
  up: { label: "Up", className: "bg-[#0969da]" },
  degraded: { label: "Degraded", className: "bg-[#bf8700]" },
  down: { label: "Down", className: "bg-[#cf222e]", style: { backgroundImage: "linear-gradient(135deg, transparent 35%, rgba(255,255,255,.45) 35%, rgba(255,255,255,.45) 48%, transparent 48%)" } },
  no_data: { label: "No data", className: "border border-slate-400 bg-slate-100", style: { backgroundImage: "repeating-linear-gradient(135deg, transparent 0, transparent 3px, #94a3b8 3px, #94a3b8 4px)" } },
};

function tone(status: StatusValue) {
  if (status === "operational") return { text: "text-blue-700", border: "border-blue-200", bg: "bg-blue-50", pill: "bg-blue-100 text-blue-800", accent: "bg-[#0969da]", Icon: CheckCircle2 };
  if (status === "degraded" || status === "maintenance") return { text: "text-amber-800", border: "border-amber-300", bg: "bg-amber-50", pill: "bg-amber-100 text-amber-900", accent: "bg-[#bf8700]", Icon: AlertTriangle };
  if (status === "unknown") return { text: "text-slate-700", border: "border-slate-300", bg: "bg-slate-50", pill: "bg-slate-200 text-slate-800", accent: "bg-slate-500", Icon: Clock3 };
  return { text: "text-red-700", border: "border-red-300", bg: "bg-red-50", pill: "bg-red-100 text-red-800", accent: "bg-[#cf222e]", Icon: XCircle };
}

function formatTime(value: string | null) {
  return value ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Not available";
}

function resolveHistoryState(date: string, today: string, component: ComponentStatus, rollup?: Rollup): HistoryState {
  if (date === today) {
    if (component.status === "operational") return "up";
    if (component.status === "degraded" || component.status === "maintenance") return "degraded";
    if (component.status === "partial_outage" || component.status === "major_outage") return "down";
    return "no_data";
  }
  if (!rollup) return "no_data";
  if (rollup.availabilityPercent >= 99.9) return "up";
  if (rollup.availabilityPercent >= 95) return "degraded";
  return "down";
}

function resolveTodayState(status: StatusValue): HistoryState {
  if (status === "operational") return "up";
  if (status === "degraded" || status === "maintenance") return "degraded";
  if (status === "partial_outage" || status === "major_outage") return "down";
  return "no_data";
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Status request failed (${response.status})`);
  return response.json() as Promise<T>;
}

function AvailabilityLegend() {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs font-medium text-slate-600" aria-label="Availability history legend">
      {(["up", "degraded", "down", "no_data"] as HistoryState[]).map((state) => <span key={state} className="inline-flex items-center gap-1.5"><span className={`h-3 w-3 rounded-[3px] ${historyStyle[state].className}`} style={historyStyle[state].style} />{historyStyle[state].label}</span>)}
    </div>
  );
}

function AvailabilityHistory({ component, dates, rollups, todaySegments }: { component: ComponentStatus; dates: string[]; rollups: Map<string, Rollup>; todaySegments: TodayHealthSegment[] }) {
  const today = dates.at(-1) || "";
  return (
    <div className="mt-5 space-y-5">
      <div>
        <div className="flex items-center justify-between gap-3 text-xs"><span className="font-bold text-slate-700">Today</span><span className="font-medium text-slate-500">15-minute intervals · UTC</span></div>
        <div className="mt-2 flex h-9 gap-[2px]" aria-label={`${component.name} health today`}>
          {(todaySegments.length ? todaySegments : [{ timestamp: "no-data", status: "unknown" as const, availabilityPercent: null, sampleCount: 0 }]).map((segment) => {
            const state = resolveTodayState(segment.status);
            const time = segment.timestamp === "no-data" ? "Today" : `${new Date(segment.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC`;
            const description = `${time}: ${historyStyle[state].label}${segment.availabilityPercent == null ? "" : `, ${segment.availabilityPercent.toFixed(2)}% available`}`;
            return <span key={segment.timestamp} role="img" aria-label={description} title={description} className={`min-w-0 flex-1 rounded-[2px] ${historyStyle[state].className}`} style={historyStyle[state].style} />;
          })}
        </div>
        <div className="mt-2 flex items-center justify-between text-[10px] font-medium text-slate-500"><span>00:00 UTC</span><span>Now</span></div>
      </div>
      <div>
        <div className="flex items-center justify-between gap-3 text-xs"><span className="font-bold text-slate-700">Last 90 days</span><span className="font-medium text-slate-500">One summary per day</span></div>
        <div className="mt-2 flex h-9 gap-[2px]" aria-label={`${component.name} 90-day availability`}>
        {dates.map((date) => {
          const rollup = rollups.get(`${component.component}:${date}`);
          const state = resolveHistoryState(date, today, component, rollup);
          const percent = date === today ? component.uptimePercent : rollup?.availabilityPercent;
          const description = `${date}: ${historyStyle[state].label}${percent == null ? "" : `, ${percent.toFixed(2)}% available`}`;
          return <span key={date} role="img" aria-label={description} title={description} className={`min-w-0 flex-1 rounded-[2px] ${historyStyle[state].className}`} style={historyStyle[state].style} />;
        })}
        </div>
        <div className="mt-2 flex items-center justify-between text-[10px] font-medium text-slate-500"><span>90 days ago</span><span>Today</span></div>
      </div>
    </div>
  );
}

export function StatusPage() {
  const [current, setCurrent] = useState<CurrentResponse | null>(null);
  const [rollups, setRollups] = useState<Rollup[]>([]);
  const [todayComponents, setTodayComponents] = useState<TodayComponent[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [livePoints, setLivePoints] = useState<LiveMetricPoint[]>([]);
  const [liveRange, setLiveRange] = useState<LiveRange>(60);
  const [liveUpdatedAt, setLiveUpdatedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [liveLoading, setLiveLoading] = useState(false);

  const refreshStatus = useCallback(async () => {
    try {
      const [nextCurrent, nextHistory, nextIncidents, nextToday] = await Promise.all([
        getJson<CurrentResponse>("/status/current"),
        getJson<{ rollups: Rollup[] }>("/status/history?days=90"),
        getJson<{ incidents: Incident[] }>("/status/incidents"),
        getJson<TodayResponse>("/status/today"),
      ]);
      setCurrent(nextCurrent); setRollups(nextHistory.rollups); setIncidents(nextIncidents.incidents); setTodayComponents(nextToday.components); setError(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load status"); }
  }, []);

  const refreshLive = useCallback(async () => {
    setLiveLoading(true);
    try {
      const next = await getJson<LiveResponse>(`/status/live?minutes=${liveRange}`);
      setLivePoints(next.points); setLiveUpdatedAt(next.updatedAt); setLiveError(null);
    } catch (cause) { setLiveError(cause instanceof Error ? cause.message : "Unable to load live metrics"); }
    finally { setLiveLoading(false); }
  }, [liveRange]);

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refreshStatus(), refreshLive()]);
    setRefreshing(false);
  }, [refreshLive, refreshStatus]);

  useEffect(() => { void refreshStatus(); const id = window.setInterval(() => void refreshStatus(), 30000); return () => window.clearInterval(id); }, [refreshStatus]);
  useEffect(() => { void refreshLive(); const id = window.setInterval(() => void refreshLive(), 30000); return () => window.clearInterval(id); }, [refreshLive]);

  const activeIncidents = incidents.filter((incident) => !incident.resolvedAt);
  const historyByComponent = useMemo(() => new Map(rollups.map((rollup) => [`${rollup.component}:${rollup.date}`, rollup])), [rollups]);
  const todayByComponent = useMemo(() => new Map(todayComponents.map((component) => [component.component, component.segments])), [todayComponents]);
  const historyDates = useMemo(() => Array.from({ length: 90 }, (_, index) => {
    const day = new Date(Date.now() - (89 - index) * 86400000);
    return day.toISOString().slice(0, 10);
  }), []);
  const overall = current?.status || "unknown";
  const overallTone = tone(overall);
  const OverallIcon = overallTone.Icon;
  const vpsStatus = current?.components.find((component) => component.component === "vps") || null;
  const serviceComponents = current?.components.filter((component) => component.component !== "vps") || [];
  const vpsAvailability: VpsAvailabilityPoint[] = vpsStatus ? historyDates.map((date) => {
    const rollup = historyByComponent.get(`vps:${date}`);
    return { date, state: resolveHistoryState(date, historyDates.at(-1) || "", vpsStatus, rollup), percent: date === historyDates.at(-1) ? vpsStatus.uptimePercent : rollup?.availabilityPercent ?? null };
  }) : historyDates.map((date) => ({ date, state: "no_data", percent: null }));

  return (
    <div className="status-page-scroll h-full overflow-y-auto bg-[#f8fafc] text-slate-950">
      <header className="border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8">
          <div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-slate-950 text-white"><ShieldCheck className="h-5 w-5" /></span><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-700">AthensAI</p><h1 className="mt-0.5 text-xl font-bold tracking-tight">Service status</h1></div></div>
          <button type="button" onClick={() => void refreshAll()} disabled={refreshing} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"><RefreshCw className={refreshing ? "h-4 w-4 animate-spin" : "h-4 w-4"} />Refresh</button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8 lg:py-10">
        <section className={`relative overflow-hidden rounded-2xl border bg-white shadow-[0_10px_30px_rgba(15,23,42,0.05)] ${overallTone.border}`}>
          <span className={`absolute inset-y-0 left-0 w-1.5 ${overallTone.accent}`} />
          <div className="flex flex-col justify-between gap-4 px-6 py-5 sm:flex-row sm:items-center sm:px-7">
            <div className="flex items-center gap-4"><span className={`grid h-12 w-12 place-items-center rounded-full ${overallTone.bg}`}><OverallIcon className={`h-6 w-6 ${overallTone.text}`} /></span><div><h2 className={`text-xl font-bold ${overallTone.text}`}>{statusCopy[overall]}</h2><p className="mt-1 text-sm text-slate-600">AthensAI production services and infrastructure</p></div></div>
            <div className="sm:text-right"><p className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700"><span className="h-2 w-2 animate-pulse rounded-full bg-blue-600" />Checks every 30 seconds</p><p className="mt-1 text-xs text-slate-500">Last checked {formatTime(current?.updatedAt || null)}</p></div>
          </div>
        </section>
        {error && <div className="mt-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">{error}. The page will retry automatically.</div>}

        <LiveMetricsPanel points={livePoints} range={liveRange} onRangeChange={setLiveRange} updatedAt={liveUpdatedAt} loading={liveLoading} error={liveError} vpsStatus={vpsStatus} availability={vpsAvailability} todaySegments={todayByComponent.get("vps") || []} />

        {activeIncidents.length > 0 && (
          <section className="mt-10"><div className="flex items-center gap-2"><span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-600" /><h2 className="text-xl font-bold">Active incidents</h2></div><div className="mt-4 grid gap-3">{activeIncidents.map((incident) => <article key={`${incident.component}-${incident.startedAt}`} className="rounded-2xl border border-red-200 bg-white p-5 shadow-sm"><div className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-red-100"><AlertTriangle className="h-4 w-4 text-red-700" /></span><div><p className="font-bold text-red-900">{incident.title}</p><p className="mt-1 text-sm leading-6 text-slate-600">{incident.description}</p><p className="mt-2 text-xs font-medium text-slate-500">Started {formatTime(incident.startedAt)}</p></div></div></article>)}</div></section>
        )}

        <section className="mt-12">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-700">Availability</p><h2 className="mt-1 text-2xl font-bold tracking-tight">Services</h2><p className="mt-1 text-sm text-slate-600">Live health checks and 90-day availability for each public component.</p></div><AvailabilityLegend /></div>
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            {serviceComponents.map((component) => {
              const style = tone(component.status);
              const Icon = style.Icon;
              return (
                <article key={component.component} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.05)] transition-shadow hover:shadow-[0_16px_40px_rgba(15,23,42,0.08)] sm:p-6">
                  <div className="flex items-start justify-between gap-4"><div><h3 className="text-lg font-bold text-slate-950">{component.name}</h3><p className="mt-2 text-sm leading-6 text-slate-600">{component.message}</p></div><span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold ${style.pill}`}><Icon className="h-3.5 w-3.5" />{component.status.replaceAll("_", " ")}</span></div>
                  <div className="mt-5 grid grid-cols-3 divide-x divide-slate-200 rounded-xl border border-slate-200 bg-slate-50 py-3 text-center"><div className="px-2"><p className="text-base font-bold tabular-nums text-slate-950">{component.uptimePercent == null ? "—" : `${component.uptimePercent.toFixed(2)}%`}</p><p className="mt-0.5 text-[11px] font-medium text-slate-500">Today uptime</p></div><div className="px-2"><p className="text-base font-bold tabular-nums text-slate-950">{component.latencyMs == null ? "—" : `${component.latencyMs} ms`}</p><p className="mt-0.5 text-[11px] font-medium text-slate-500">Latency</p></div><div className="px-2"><p className={`text-base font-bold capitalize ${style.text}`}>{component.status === "operational" ? "Up" : component.status === "unknown" ? "Unknown" : "Attention"}</p><p className="mt-0.5 text-[11px] font-medium text-slate-500">Right now</p></div></div>
                  <AvailabilityHistory component={component} dates={historyDates} rollups={historyByComponent} todaySegments={todayByComponent.get(component.component) || []} />
                </article>
              );
            })}
          </div>
        </section>

        <section className="mt-12"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-700">Timeline</p><h2 className="mt-1 text-2xl font-bold tracking-tight">Recent incidents</h2></div>{incidents.length === 0 ? <div className="mt-4 flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-5 text-sm font-medium text-blue-900"><CheckCircle2 className="h-5 w-5 text-blue-700" />No incidents have been recorded.</div> : <div className="mt-4 divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">{incidents.slice(0, 10).map((incident) => <div key={`${incident.component}-${incident.startedAt}`} className="flex gap-4 p-5"><span className={`mt-1 h-3 w-3 shrink-0 rounded-full ${incident.resolvedAt ? "bg-blue-600" : "bg-red-600"}`} /><div><p className="font-bold text-slate-900">{incident.title}</p><p className="mt-1 text-sm text-slate-600">{incident.resolvedAt ? `Resolved ${formatTime(incident.resolvedAt)}` : "Investigating"} · Started {formatTime(incident.startedAt)}</p></div></div>)}</div>}</section>

        <footer className="mt-14 flex flex-col justify-between gap-2 border-t border-slate-200 py-6 text-xs text-slate-500 sm:flex-row sm:items-center"><span className="inline-flex items-center gap-2"><Clock3 className="h-3.5 w-3.5" />Near-real-time data from AthensAI production health checks.</span><span>Blue = up · Red = down · Amber = degraded</span></footer>
      </main>
    </div>
  );
}
