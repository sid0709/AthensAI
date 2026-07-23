import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock3, RefreshCw, XCircle } from "lucide-react";
import { API_BASE } from "@/lib/api-base";

type StatusValue = "operational" | "degraded" | "partial_outage" | "major_outage" | "maintenance" | "unknown";
type ComponentStatus = { component: string; name: string; status: StatusValue; message: string; lastCheckedAt: string | null; lastSuccessAt: string | null; latencyMs: number | null; uptimePercent: number | null };
type CurrentResponse = { status: StatusValue; updatedAt: string; components: ComponentStatus[] };
type Rollup = { date: string; component: string; name: string; availabilityPercent: number; avgLatencyMs: number | null; maxLatencyMs: number | null; sampleCount: number };
type Incident = { component: string; name: string; status: StatusValue; severity: string; title: string; description: string; startedAt: string; resolvedAt: string | null };

const statusCopy: Record<StatusValue, string> = {
  operational: "All systems operational", degraded: "Some systems are degraded", partial_outage: "Partial system outage", major_outage: "Major system outage", maintenance: "Maintenance in progress", unknown: "Status is currently unknown",
};

function tone(status: StatusValue) {
  if (status === "operational") return { text: "text-emerald-700", bg: "bg-emerald-500", soft: "bg-emerald-50 border-emerald-200", Icon: CheckCircle2 };
  if (status === "degraded" || status === "maintenance") return { text: "text-amber-700", bg: "bg-amber-500", soft: "bg-amber-50 border-amber-200", Icon: AlertTriangle };
  if (status === "unknown") return { text: "text-slate-600", bg: "bg-slate-400", soft: "bg-slate-50 border-slate-200", Icon: Clock3 };
  return { text: "text-red-700", bg: "bg-red-500", soft: "bg-red-50 border-red-200", Icon: XCircle };
}

function formatTime(value: string | null) {
  return value ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Not available";
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Status request failed (${response.status})`);
  return response.json() as Promise<T>;
}

export function StatusPage() {
  const [current, setCurrent] = useState<CurrentResponse | null>(null);
  const [rollups, setRollups] = useState<Rollup[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const [nextCurrent, nextHistory, nextIncidents] = await Promise.all([
        getJson<CurrentResponse>("/status/current"),
        getJson<{ rollups: Rollup[] }>("/status/history?days=90"),
        getJson<{ incidents: Incident[] }>("/status/incidents"),
      ]);
      setCurrent(nextCurrent); setRollups(nextHistory.rollups); setIncidents(nextIncidents.incidents); setError(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load status"); }
    finally { setRefreshing(false); }
  }, []);

  useEffect(() => { void refresh(); const id = window.setInterval(() => void refresh(), 60000); return () => window.clearInterval(id); }, [refresh]);

  const activeIncidents = incidents.filter((incident) => !incident.resolvedAt);
  const historyByComponent = useMemo(() => new Map(rollups.map((rollup) => [`${rollup.component}:${rollup.date}`, rollup])), [rollups]);
  const historyDates = useMemo(() => Array.from({ length: 90 }, (_, index) => {
    const day = new Date(Date.now() - (89 - index) * 86400000);
    return day.toISOString().slice(0, 10);
  }), []);
  const overall = current?.status || "unknown";
  const overallTone = tone(overall);
  const OverallIcon = overallTone.Icon;

  return (
    <div className="min-h-screen bg-[#f6f8fa] text-[#24292f]">
      <header className="border-b border-[#d0d7de] bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-5 sm:px-8">
          <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#57606a]">AthensAI</p><h1 className="mt-1 text-xl font-semibold tracking-tight">System status</h1></div>
          <button onClick={() => void refresh()} disabled={refreshing} className="inline-flex items-center gap-2 rounded-md border border-[#d0d7de] bg-white px-3 py-2 text-sm font-medium text-[#24292f] shadow-sm hover:bg-[#f6f8fa] disabled:opacity-60"><RefreshCw className={refreshing ? "h-4 w-4 animate-spin" : "h-4 w-4"} />Refresh</button>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-5 py-8 sm:px-8">
        <section className={`flex items-center gap-3 rounded-md border px-5 py-4 shadow-sm ${overallTone.soft}`}><OverallIcon className={`h-6 w-6 ${overallTone.text}`} /><div><h2 className={`text-lg font-semibold ${overallTone.text}`}>{statusCopy[overall]}</h2><p className="mt-0.5 text-sm text-[#57606a]">Last checked {formatTime(current?.updatedAt || null)}</p></div></section>
        {error && <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}. The page will retry automatically.</div>}
        {activeIncidents.length > 0 && <section className="mt-8"><h2 className="text-xl font-semibold">Active incidents</h2><div className="mt-3 space-y-3">{activeIncidents.map((incident) => <article key={`${incident.component}-${incident.startedAt}`} className="rounded-md border border-amber-200 bg-amber-50 p-4"><p className="font-semibold text-amber-900">{incident.title}</p><p className="mt-1 text-sm text-amber-800">{incident.description}</p><p className="mt-2 text-xs text-amber-700">Started {formatTime(incident.startedAt)}</p></article>)}</div></section>}
        <section className="mt-8"><div className="flex items-end justify-between"><div><h2 className="text-xl font-semibold">Current status</h2><p className="mt-1 text-sm text-[#57606a]">Service availability and recent health checks.</p></div><span className="hidden text-xs text-[#57606a] sm:block">Updates every minute</span></div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">{(current?.components || []).map((component) => { const style = tone(component.status); const Icon = style.Icon; return <article key={component.component} className="rounded-md border border-[#d0d7de] bg-white p-5 shadow-sm"><div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold">{component.name}</h3><p className={`mt-1 text-sm font-medium ${style.text}`}>{component.status.replaceAll("_", " ")}</p></div><Icon className={`h-5 w-5 ${style.text}`} /></div><p className="mt-4 text-sm text-[#57606a]">{component.message}</p><div className="mt-4 flex justify-between border-t border-[#d8dee4] pt-3 text-xs text-[#57606a]"><span>Uptime {component.uptimePercent == null ? "—" : `${component.uptimePercent.toFixed(2)}%`}</span><span>Checked {formatTime(component.lastCheckedAt)}</span></div><div className="mt-4 flex gap-0.5" aria-label="90-day availability history">{historyDates.map((date) => { const item = historyByComponent.get(`${component.component}:${date}`); const percent = item?.availabilityPercent; return <span key={date} title={`${date}: ${percent == null ? "No data" : `${percent.toFixed(2)}% available`}`} className={`h-6 min-w-[2px] flex-1 rounded-[1px] ${percent == null ? "bg-[#d8dee4]" : percent >= 99.9 ? "bg-emerald-300" : percent >= 95 ? "bg-amber-300" : "bg-red-400"}`} />; })}</div></article>; })}</div>
        </section>
        <section className="mt-10"><h2 className="text-xl font-semibold">Recent incidents</h2>{incidents.length === 0 ? <p className="mt-3 rounded-md border border-[#d0d7de] bg-white p-5 text-sm text-[#57606a]">No incidents have been recorded.</p> : <div className="mt-3 divide-y divide-[#d8dee4] rounded-md border border-[#d0d7de] bg-white">{incidents.slice(0, 10).map((incident) => <div key={`${incident.component}-${incident.startedAt}`} className="flex gap-3 p-4"><div className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${incident.resolvedAt ? "bg-emerald-500" : "bg-amber-500"}`} /><div><p className="font-medium">{incident.title}</p><p className="mt-1 text-sm text-[#57606a]">{incident.resolvedAt ? `Resolved ${formatTime(incident.resolvedAt)}` : "Investigating"} · Started {formatTime(incident.startedAt)}</p></div></div>)}</div>}</section>
        <footer className="mt-12 flex items-center gap-2 border-t border-[#d8dee4] pt-5 text-xs text-[#57606a]"><Clock3 className="h-3.5 w-3.5" />Status information is collected from AthensAI production health checks.</footer>
      </main>
    </div>
  );
}
