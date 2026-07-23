import { Activity, Clock3, Cpu, HardDrive, MemoryStick, Server, TimerReset } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type LiveRange = 15 | 60 | 360 | 1440;

export type LiveMetricPoint = {
  timestamp: string;
  cpuPercent: number | null;
  memoryPercent: number | null;
  diskPercent: number | null;
  loadPercent: number | null;
  uptimeSeconds: number | null;
};

export type VpsStatus = {
  status: "operational" | "degraded" | "partial_outage" | "major_outage" | "maintenance" | "unknown";
  message: string;
  lastCheckedAt: string | null;
  uptimePercent: number | null;
} | null;

export type VpsAvailabilityPoint = {
  date: string;
  state: "up" | "degraded" | "down" | "no_data";
  percent: number | null;
};

type MetricKey = "cpuPercent" | "memoryPercent" | "diskPercent";

const ranges: Array<{ value: LiveRange; label: string }> = [
  { value: 15, label: "15m" },
  { value: 60, label: "1h" },
  { value: 360, label: "6h" },
  { value: 1440, label: "24h" },
];

const metrics: Array<{
  key: MetricKey;
  label: string;
  helper: string;
  color: string;
  icon: typeof Cpu;
  warning: number;
  critical: number;
}> = [
  { key: "cpuPercent", label: "CPU", helper: "Processor utilization", color: "#2f81f7", icon: Cpu, warning: 75, critical: 90 },
  { key: "memoryPercent", label: "Memory", helper: "Physical RAM in use", color: "#a371f7", icon: MemoryStick, warning: 80, critical: 95 },
  { key: "diskPercent", label: "Disk", helper: "Root filesystem used", color: "#d29922", icon: HardDrive, warning: 75, critical: 90 },
];

function formatUptime(seconds: number | null | undefined) {
  if (seconds == null) return "Not available";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return days > 0 ? `${days}d ${hours}h` : `${hours}h ${minutes}m`;
}

function statusPresentation(status: NonNullable<VpsStatus>["status"]) {
  if (status === "operational") return { label: "Online", dot: "bg-[#3fb950]", badge: "border-[#2ea043]/40 bg-[#238636]/20 text-[#7ee787]" };
  if (status === "degraded" || status === "maintenance") return { label: status === "maintenance" ? "Maintenance" : "Degraded", dot: "bg-[#d29922]", badge: "border-[#d29922]/40 bg-[#9e6a03]/20 text-[#e3b341]" };
  if (status === "unknown") return { label: "No signal", dot: "bg-[#8b949e]", badge: "border-[#8b949e]/40 bg-[#6e7681]/20 text-[#c9d1d9]" };
  return { label: "Offline", dot: "bg-[#f85149]", badge: "border-[#f85149]/40 bg-[#da3633]/20 text-[#ff7b72]" };
}

function metricHealth(value: number | null | undefined, warning: number, critical: number) {
  if (value == null) return { label: "Waiting", text: "text-slate-500", bar: "bg-slate-300" };
  if (value >= critical) return { label: "Critical", text: "text-red-700", bar: "bg-red-600" };
  if (value >= warning) return { label: "Warning", text: "text-amber-700", bar: "bg-amber-500" };
  return { label: "Healthy", text: "text-blue-700", bar: "bg-blue-600" };
}

function MetricChart({ metric, points }: { metric: (typeof metrics)[number]; points: LiveMetricPoint[] }) {
  const current = points.at(-1)?.[metric.key];
  const health = metricHealth(current, metric.warning, metric.critical);
  const Icon = metric.icon;
  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_12px_36px_rgba(15,23,42,0.06)]">
      <div className="flex items-start justify-between gap-3 px-5 pt-5">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl" style={{ backgroundColor: `${metric.color}14`, color: metric.color }}>
            <Icon className="h-5 w-5" />
          </span>
          <div>
            <h3 className="font-semibold text-slate-950">{metric.label}</h3>
            <p className="mt-0.5 text-xs text-slate-500">{metric.helper}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold tabular-nums text-slate-950">{current == null ? "—" : `${current.toFixed(1)}%`}</p>
          <p className={`text-xs font-semibold ${health.text}`}>{health.label}</p>
        </div>
      </div>

      <div className="mx-5 mt-4 h-1.5 overflow-hidden rounded-full bg-slate-100" aria-label={`${metric.label} utilization ${current == null ? "unavailable" : `${current.toFixed(1)} percent`}`}>
        <div className={`h-full rounded-full transition-[width] duration-500 ${health.bar}`} style={{ width: `${Math.min(Math.max(current ?? 0, 0), 100)}%` }} />
      </div>

      <div className="mt-3 h-32" aria-label={`${metric.label} time-series chart`}>
        {points.length === 0 ? (
          <div className="mx-5 flex h-28 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 text-xs font-medium text-slate-500">Waiting for the first VPS sample</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: -28 }}>
              <defs>
                <linearGradient id={`fill-${metric.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="4%" stopColor={metric.color} stopOpacity={0.28} />
                  <stop offset="96%" stopColor={metric.color} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 5" vertical={false} />
              <XAxis dataKey="timestamp" minTickGap={40} tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(value: string) => new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} />
              <YAxis domain={[0, 100]} ticks={[0, 50, 100]} tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(value: number) => `${value}%`} />
              <Tooltip contentStyle={{ borderRadius: 12, borderColor: "#cbd5e1", boxShadow: "0 12px 30px rgba(15,23,42,.12)", fontSize: 12 }} labelFormatter={(value) => new Date(String(value)).toLocaleString()} formatter={(value) => [`${Number(value).toFixed(1)}%`, metric.label]} />
              <Area connectNulls type="monotone" dataKey={metric.key} stroke={metric.color} fill={`url(#fill-${metric.key})`} strokeWidth={2.5} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </article>
  );
}

export function LiveMetricsPanel({
  points,
  range,
  onRangeChange,
  updatedAt,
  loading,
  error,
  vpsStatus,
  availability,
}: {
  points: LiveMetricPoint[];
  range: LiveRange;
  onRangeChange: (range: LiveRange) => void;
  updatedAt: string | null;
  loading: boolean;
  error: string | null;
  vpsStatus: VpsStatus;
  availability: VpsAvailabilityPoint[];
}) {
  const current = points.at(-1);
  const isFresh = Boolean(updatedAt) && Date.now() - new Date(updatedAt || 0).getTime() < 120000 && !error;
  const vps = statusPresentation(vpsStatus?.status || "unknown");

  return (
    <section className="mt-7" aria-labelledby="live-metrics-heading">
      <div className="overflow-hidden rounded-3xl bg-[radial-gradient(circle_at_top_right,_#1f6feb_0,_#161b22_38%,_#0d1117_78%)] text-white shadow-[0_24px_70px_rgba(15,23,42,0.22)]">
        <div className="grid gap-6 px-6 py-7 sm:px-8 lg:grid-cols-[1.35fr_1fr] lg:items-center">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="grid h-12 w-12 place-items-center rounded-2xl border border-white/10 bg-white/10"><Server className="h-6 w-6 text-blue-300" /></span>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-200">Production VPS</p>
                <h2 id="live-metrics-heading" className="mt-1 text-2xl font-bold tracking-tight">Infrastructure health</h2>
              </div>
              <span className={`ml-0 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-bold lg:ml-2 ${vps.badge}`}>
                <span className={`h-2 w-2 rounded-full ${vps.dot} ${vpsStatus?.status === "operational" ? "animate-pulse" : ""}`} />{vps.label}
              </span>
            </div>
            <p className="mt-5 max-w-2xl text-sm leading-6 text-slate-300">{vpsStatus?.message || "Waiting for the production VPS health signal."}</p>
            {error && <p className="mt-3 rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/[0.07] p-4 backdrop-blur-sm">
              <TimerReset className="h-4 w-4 text-blue-300" /><p className="mt-3 text-xl font-bold tabular-nums">{formatUptime(current?.uptimeSeconds)}</p><p className="mt-1 text-xs text-slate-400">System uptime</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.07] p-4 backdrop-blur-sm">
              <Activity className="h-4 w-4 text-blue-300" /><p className="mt-3 text-xl font-bold tabular-nums">{current?.loadPercent == null ? "—" : `${current.loadPercent.toFixed(1)}%`}</p><p className="mt-1 text-xs text-slate-400">Load per core</p>
            </div>
            <div className="col-span-2 rounded-2xl border border-white/10 bg-white/[0.07] p-4 backdrop-blur-sm sm:col-span-2 lg:col-span-2">
              <div className="flex items-center justify-between gap-3"><span className="inline-flex items-center gap-2 text-sm font-semibold"><span className={`h-2 w-2 rounded-full ${isFresh ? "bg-[#3fb950]" : "bg-[#f85149]"}`} />{isFresh ? "Receiving live data" : "Signal delayed"}</span><span className="text-xs text-slate-400">30s refresh</span></div>
              <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-400"><Clock3 className="h-3.5 w-3.5" />Last VPS sample {updatedAt ? new Date(updatedAt).toLocaleString() : "not available"}</p>
            </div>
          </div>
        </div>
        <div className="border-t border-white/10 bg-black/10 px-6 py-5 sm:px-8">
          <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center"><div><p className="text-sm font-bold text-white">VPS availability</p><p className="mt-0.5 text-xs text-slate-400">Daily status over the last 90 days</p></div><div className="flex items-center gap-3 text-[11px] font-semibold text-slate-300"><span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[#58a6ff]" />Up</span><span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[#f85149]" />Down</span><span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[#d29922]" />Degraded</span></div></div>
          <div className="mt-4 grid h-8 grid-cols-[repeat(90,minmax(2px,1fr))] gap-[2px]" aria-label="VPS 90-day availability">
            {availability.map((point) => {
              const style = point.state === "up"
                ? { backgroundColor: "#58a6ff" }
                : point.state === "down"
                  ? { backgroundColor: "#f85149", backgroundImage: "linear-gradient(135deg, transparent 35%, rgba(255,255,255,.5) 35%, rgba(255,255,255,.5) 48%, transparent 48%)" }
                  : point.state === "degraded"
                    ? { backgroundColor: "#d29922" }
                    : { backgroundColor: "#30363d", backgroundImage: "repeating-linear-gradient(135deg, transparent 0, transparent 3px, #6e7681 3px, #6e7681 4px)" };
              const label = `${point.date}: ${point.state.replace("_", " ")}${point.percent == null ? "" : `, ${point.percent.toFixed(2)}% available`}`;
              return <span key={point.date} role="img" aria-label={label} title={label} className="rounded-[2px]" style={style} />;
            })}
          </div>
          <div className="mt-2 flex justify-between text-[10px] font-medium text-slate-500"><span>90 days ago</span><span>Today</span></div>
        </div>
      </div>

      <div className="mt-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div><h2 className="text-xl font-bold tracking-tight text-slate-950">Live resource telemetry</h2><p className="mt-1 text-sm text-slate-600">Near-real-time CPU, memory, and storage utilization from the VPS.</p></div>
        <div className="inline-flex w-fit rounded-xl border border-slate-200 bg-white p-1 shadow-sm" aria-label="Live metrics time range">
          {ranges.map((item) => (
            <button key={item.value} type="button" onClick={() => onRangeChange(item.value)} aria-pressed={range === item.value} className={`min-w-12 rounded-lg px-3 py-2 text-xs font-bold transition-colors ${range === item.value ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"}`}>{item.label}</button>
          ))}
        </div>
      </div>

      {error && <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">Live metrics are temporarily unavailable. The page will keep retrying.</div>}
      <div className={`mt-4 grid gap-4 lg:grid-cols-3 ${loading ? "opacity-70" : ""}`} aria-busy={loading} aria-live="polite">
        {metrics.map((metric) => <MetricChart key={metric.key} metric={metric} points={points} />)}
      </div>
    </section>
  );
}
