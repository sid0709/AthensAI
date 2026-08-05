import { Database, RefreshCw, Search } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { LiveRange } from "./LiveMetricsPanel";

export type DependencyMetricPoint = { timestamp: string } & Record<string, string | number | null>;
export type DependencyMetricSeries = {
  updatedAt: string | null;
  current: DependencyMetricPoint | null;
  points: DependencyMetricPoint[];
  source?: "prometheus";
  delayed?: boolean;
  expectedDelaySeconds?: number;
};
export type DependencyMetrics = {
  "firestore-tasks": DependencyMetricSeries;
  "algolia-sync": DependencyMetricSeries;
};

type Metric = { key: string; label: string; color: string; format: (value: number | null) => string };

const number = (value: number | null) => value == null ? "—" : new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);
const seconds = (value: number | null) => value == null ? "—" : `${value.toFixed(1)} s`;

const cards: Array<{
  key: keyof DependencyMetrics;
  title: string;
  description: string;
  Icon: typeof Database;
  metrics: Metric[];
  chart: string[];
}> = [
  {
    key: "firestore-tasks", title: "Task workers", description: "Firestore queue and lease health", Icon: Database,
    metrics: [
      { key: "oldestQueueAgeSeconds", label: "Oldest queued", color: "#2563eb", format: seconds },
      { key: "expiredLeaseCount", label: "Expired leases", color: "#dc2626", format: number },
    ], chart: ["oldestQueueAgeSeconds", "expiredLeaseCount"],
  },
  {
    key: "algolia-sync", title: "Algolia sync", description: "Full-text search outbox health", Icon: Search,
    metrics: [
      { key: "outboxLagSeconds", label: "Outbox lag", color: "#d97706", format: seconds },
    ], chart: ["outboxLagSeconds"],
  },
];

function value(point: DependencyMetricPoint | null, key: string) {
  const raw = point?.[key];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

function MetricCard({ definition, series }: { definition: (typeof cards)[number]; series: DependencyMetricSeries | undefined }) {
  const chartMetrics = definition.metrics.filter((metric) => definition.chart.includes(metric.key));
  const Icon = definition.Icon;
  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-50 text-blue-700"><Icon className="h-5 w-5" /></span><div><h3 className="font-bold text-slate-950">{definition.title}</h3><p className="mt-0.5 text-xs text-slate-500">{definition.description}</p></div></div>
        <span className="rounded-full bg-blue-100 px-2.5 py-1 text-[10px] font-bold text-blue-800">Live</span>
      </div>
      <div className="grid grid-cols-2 gap-px bg-slate-200 sm:grid-cols-3">
        {definition.metrics.map((metric) => <div key={metric.key} className="bg-white px-4 py-3"><p className="text-lg font-bold tabular-nums text-slate-950">{metric.format(value(series?.current || null, metric.key))}</p><p className="mt-0.5 text-[11px] font-medium text-slate-500">{metric.label}</p></div>)}
      </div>
      <div className="h-44 px-2 py-3">
        {!series?.points.length ? <div className="mx-3 flex h-full items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 text-xs font-medium text-slate-500">Waiting for telemetry</div> : (
          <ResponsiveContainer width="100%" height="100%"><AreaChart data={series.points} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
            <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 5" vertical={false} />
            <XAxis dataKey="timestamp" minTickGap={40} tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(item: string) => new Date(item).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} />
            <YAxis width={40} tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ borderRadius: 12, borderColor: "#cbd5e1", fontSize: 12 }} labelFormatter={(item) => new Date(String(item)).toLocaleString()} />
            {chartMetrics.map((metric) => <Area key={metric.key} connectNulls type="monotone" dataKey={metric.key} name={metric.label} stroke={metric.color} fill={metric.color} fillOpacity={0.06} strokeWidth={2} isAnimationActive={false} />)}
          </AreaChart></ResponsiveContainer>
        )}
      </div>
      <p className="border-t border-slate-100 px-5 py-2.5 text-[10px] text-slate-500">Telemetry sampled: {series?.updatedAt ? new Date(series.updatedAt).toLocaleString() : "not available"}</p>
    </article>
  );
}

export function DependencyMetricsPanel({ dependencies, range, loading, error }: { dependencies: DependencyMetrics | null; range: LiveRange; loading: boolean; error: string | null }) {
  return (
    <section className="mt-12" aria-labelledby="dependency-telemetry-heading">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-700">Dependencies</p><h2 id="dependency-telemetry-heading" className="mt-1 text-2xl font-bold tracking-tight">Operational telemetry</h2><p className="mt-1 text-sm text-slate-600">Safe operational metrics for the selected {range === 1440 ? "24 hours" : `${range} minutes`}. Inventory totals and internal names remain private.</p></div>{loading && <span className="inline-flex items-center gap-2 text-xs font-semibold text-slate-500"><RefreshCw className="h-3.5 w-3.5 animate-spin" />Refreshing</span>}</div>
      {error && <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">Dependency telemetry is temporarily unavailable. Health checks above continue to update.</div>}
      <div className={`mt-5 grid gap-4 xl:grid-cols-2 ${loading ? "opacity-75" : ""}`} aria-busy={loading}>{cards.map((definition) => <MetricCard key={definition.key} definition={definition} series={dependencies?.[definition.key]} />)}</div>
    </section>
  );
}
