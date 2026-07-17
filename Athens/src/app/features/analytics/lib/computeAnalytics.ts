import type { ApplyRunSummary } from "../../../api/avalonLog";
import type { DailyApplicationRow, FrequencyDayRow, JobSourceSummaryRow } from "../../../api/reports";
import { normalizeId } from "../../../lib/job-adapters";
import { formatMonthLabel, formatWeekLabel, isWithinRange } from "./dateRange";

export type FunnelItem = { s: string; n: number; p: number };
export type TrendPoint = { m: string; apps: number; responses: number; interviews: number };
export type RoleSlice = { name: string; v: number; c: string };
export type SourceRow = { src: string; apps: number; responses: number; rate: number };
export type HeatmapRow = { day: string; h6: number; h9: number; h12: number; h15: number; h18: number; h21: number };
export type StageOverTime = { m: string; applied: number; screening: number; interview: number; offer: number };
export type VelocityPoint = { w: string; response: number; interview: number; offer: number };
export type CohortPoint = { m: string; c1: number; c2: number; c3: number };
export type MatchPoint = { match: number; likelihood: number; company: string };
export type AgentStatusSlice = { name: string; v: number; c: string };

const ROLE_COLORS: Record<string, string> = {
  Frontend: "#6c5ce7",
  "Full Stack": "#2dd4bf",
  "ML/AI": "#f59e0b",
  DevOps: "#f472b6",
  Backend: "#60a5fa",
  Other: "#94a3b8",
};

const AGENT_STATUS_COLORS: Record<string, string> = {
  applied: "#6c5ce7",
  succeeded: "#2dd4bf",
  failed: "#f472b6",
  running: "#f59e0b",
  other: "#94a3b8",
};

const DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const HOUR_BUCKETS = [
  { key: "h6" as const, min: 0, max: 8 },
  { key: "h9" as const, min: 8, max: 11 },
  { key: "h12" as const, min: 11, max: 14 },
  { key: "h15" as const, min: 14, max: 17 },
  { key: "h18" as const, min: 17, max: 20 },
  { key: "h21" as const, min: 20, max: 24 },
];

type StatusDates = {
  appliedDate?: string;
  scheduledDate?: string;
  declinedDate?: string;
};

function extractStatusDates(doc: Record<string, unknown>, applierId: string | null): StatusDates | null {
  const statusArr = doc.status as Record<string, unknown>[] | undefined;
  if (!Array.isArray(statusArr) || !applierId) return null;
  const row = statusArr.find((s) => s && normalizeId(s.applier) === applierId);
  if (!row) return null;
  return {
    appliedDate: typeof row.appliedDate === "string" ? row.appliedDate : undefined,
    scheduledDate: typeof row.scheduledDate === "string" ? row.scheduledDate : undefined,
    declinedDate: typeof row.declinedDate === "string" ? row.declinedDate : undefined,
  };
}

function categorizeRole(title: string): string {
  const t = title.toLowerCase();
  if (/\b(ml|machine learning|ai engineer|data scien|nlp|llm)\b/.test(t)) return "ML/AI";
  if (/\b(devops|sre|platform engineer|infra|cloud engineer)\b/.test(t)) return "DevOps";
  if (/\b(full.?stack|fullstack)\b/.test(t)) return "Full Stack";
  if (/\b(front.?end|frontend|ui engineer)\b/.test(t)) return "Frontend";
  if (/\b(back.?end|backend|api engineer)\b/.test(t)) return "Backend";
  return "Other";
}

function pct(n: number, total: number): number {
  return total > 0 ? Math.round((n / total) * 1000) / 10 : 0;
}

function daysBetween(a: string, b: string): number {
  return Math.abs(new Date(b).getTime() - new Date(a).getTime()) / 86400000;
}

export function computeSourceRows(summary: JobSourceSummaryRow[]): SourceRow[] {
  return summary
    .filter((r) => r.applied > 0 || r.scheduled > 0)
    .map((r) => ({
      src: r.source || "Other",
      apps: r.applied,
      responses: r.scheduled,
      rate: pct(r.scheduled, r.applied),
    }))
    .sort((a, b) => b.apps - a.apps);
}

export function computeTrend(
  daily: DailyApplicationRow[],
  jobDocs: Record<string, unknown>[],
  applierId: string | null,
  startDate: string,
  endDate: string,
): TrendPoint[] {
  const monthMap = new Map<string, TrendPoint>();

  for (const { date, value } of daily) {
    const m = formatMonthLabel(date);
    const cur = monthMap.get(m) ?? { m, apps: 0, responses: 0, interviews: 0 };
    cur.apps += value;
    monthMap.set(m, cur);
  }

  for (const doc of jobDocs) {
    const st = extractStatusDates(doc, applierId);
    if (!st?.scheduledDate || !isWithinRange(st.scheduledDate, startDate, endDate)) continue;
    const m = formatMonthLabel(st.scheduledDate);
    const cur = monthMap.get(m) ?? { m, apps: 0, responses: 0, interviews: 0 };
    cur.responses += 1;
    cur.interviews += 1;
    monthMap.set(m, cur);
  }

  return [...monthMap.values()];
}

export function computeRolePie(jobDocs: Record<string, unknown>[], applierId: string | null, startDate: string, endDate: string): RoleSlice[] {
  const counts = new Map<string, number>();
  for (const doc of jobDocs) {
    const st = extractStatusDates(doc, applierId);
    if (!st?.appliedDate || !isWithinRange(st.appliedDate, startDate, endDate)) continue;
    const role = categorizeRole(String(doc.title || ""));
    counts.set(role, (counts.get(role) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  if (total === 0) return [];
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, n]) => ({
      name,
      v: Math.round((n / total) * 100),
      c: ROLE_COLORS[name] ?? ROLE_COLORS.Other,
    }));
}

export function computeFunnel(statusCounts: Record<string, number>): FunnelItem[] {
  const applied = statusCounts.applied ?? 0;
  const scheduled = statusCounts.scheduled ?? 0;
  const declined = statusCounts.declined ?? 0;
  const posted = statusCounts.posted ?? 0;
  const base = applied || posted || 1;
  const items: FunnelItem[] = [
    { s: "Posted", n: posted, p: posted > 0 ? 100 : 0 },
    { s: "Applied", n: applied, p: pct(applied, base) },
    { s: "Interview", n: scheduled, p: pct(scheduled, base) },
    { s: "Declined", n: declined, p: pct(declined, base) },
  ];
  return items.filter((i) => i.n > 0 || i.s === "Applied");
}

export function computeStageOverTime(
  daily: DailyApplicationRow[],
  jobDocs: Record<string, unknown>[],
  applierId: string | null,
  startDate: string,
  endDate: string,
): StageOverTime[] {
  const monthMap = new Map<string, StageOverTime>();

  for (const { date, value } of daily) {
    const m = formatMonthLabel(date);
    const cur = monthMap.get(m) ?? { m, applied: 0, screening: 0, interview: 0, offer: 0 };
    cur.applied += value;
    monthMap.set(m, cur);
  }

  for (const doc of jobDocs) {
    const st = extractStatusDates(doc, applierId);
    if (st?.scheduledDate && isWithinRange(st.scheduledDate, startDate, endDate)) {
      const m = formatMonthLabel(st.scheduledDate);
      const cur = monthMap.get(m) ?? { m, applied: 0, screening: 0, interview: 0, offer: 0 };
      cur.interview += 1;
      cur.screening += 1;
      monthMap.set(m, cur);
    }
    if (st?.declinedDate && isWithinRange(st.declinedDate, startDate, endDate)) {
      const m = formatMonthLabel(st.declinedDate);
      const cur = monthMap.get(m) ?? { m, applied: 0, screening: 0, interview: 0, offer: 0 };
      cur.screening += 1;
      monthMap.set(m, cur);
    }
  }

  return [...monthMap.values()];
}

export function computeHeatmap(freq: FrequencyDayRow[], runs: ApplyRunSummary[], startDate: string, endDate: string): HeatmapRow[] {
  const grid: Record<string, HeatmapRow> = {};
  for (const day of DAY_ORDER) {
    grid[day] = { day, h6: 0, h9: 0, h12: 0, h15: 0, h18: 0, h21: 0 };
  }

  for (const row of freq) {
    const d = new Date(`${row._id}T12:00:00`);
    const day = DAY_NAMES[d.getDay()];
    if (!grid[day]) continue;
    for (const { hour, count } of row.hourlyData) {
      const bucket = HOUR_BUCKETS.find((b) => hour >= b.min && hour < b.max);
      if (bucket) grid[day][bucket.key] += count;
    }
  }

  for (const run of runs) {
    const iso = run.startedAt;
    if (!isWithinRange(iso, startDate, endDate)) continue;
    const d = new Date(iso);
    const day = DAY_NAMES[d.getDay()];
    if (!grid[day]) continue;
    const hour = d.getHours();
    const bucket = HOUR_BUCKETS.find((b) => hour >= b.min && hour < b.max);
    if (bucket) grid[day][bucket.key] += 1;
  }

  return DAY_ORDER.map((day) => grid[day]).filter(Boolean);
}

export function computeAvgResponseDays(
  jobDocs: Record<string, unknown>[],
  applierId: string | null,
  startDate: string,
  endDate: string,
): number | null {
  const gaps: number[] = [];
  for (const doc of jobDocs) {
    const st = extractStatusDates(doc, applierId);
    if (!st?.appliedDate || !st.scheduledDate) continue;
    if (!isWithinRange(st.appliedDate, startDate, endDate)) continue;
    gaps.push(daysBetween(st.appliedDate, st.scheduledDate));
  }
  if (gaps.length === 0) return null;
  return Math.round((gaps.reduce((a, b) => a + b, 0) / gaps.length) * 10) / 10;
}

export function computeVelocitySeries(
  jobDocs: Record<string, unknown>[],
  applierId: string | null,
  startDate: string,
  endDate: string,
): VelocityPoint[] {
  const weekMap = new Map<string, { gaps: number[]; interviews: number; offers: number }>();

  for (const doc of jobDocs) {
    const st = extractStatusDates(doc, applierId);
    if (!st?.appliedDate || !isWithinRange(st.appliedDate, startDate, endDate)) continue;
    const w = formatWeekLabel(new Date(st.appliedDate));
    const cur = weekMap.get(w) ?? { gaps: [], interviews: 0, offers: 0 };
    if (st.scheduledDate) {
      cur.gaps.push(daysBetween(st.appliedDate, st.scheduledDate));
      cur.interviews += 1;
    }
    weekMap.set(w, cur);
  }

  return [...weekMap.entries()]
    .slice(-6)
    .map(([w, { gaps, interviews }]) => ({
      w,
      response: gaps.length ? Math.round((gaps.reduce((a, b) => a + b, 0) / gaps.length) * 10) / 10 : 0,
      interview: interviews,
      offer: 0,
    }));
}

export function computeCohort(daily: DailyApplicationRow[], jobDocs: Record<string, unknown>[], applierId: string | null, startDate: string, endDate: string): CohortPoint[] {
  const months = computeStageOverTime(daily, jobDocs, applierId, startDate, endDate);
  return months.map(({ m, applied, screening, interview }) => ({
    m,
    c1: 100,
    c2: pct(screening, applied || 1),
    c3: pct(interview, applied || 1),
  }));
}

export function computeMatchScatter(jobDocs: Record<string, unknown>[], applierId: string | null, startDate: string, endDate: string): MatchPoint[] {
  const points: MatchPoint[] = [];
  for (const doc of jobDocs) {
    const st = extractStatusDates(doc, applierId);
    if (!st?.appliedDate || !isWithinRange(st.appliedDate, startDate, endDate)) continue;
    const score = typeof doc._score === "number" ? doc._score : typeof doc.scoreOverall === "number" ? doc.scoreOverall : null;
    if (score == null) continue;
    const company = (doc.company as { name?: string } | undefined)?.name ?? "Unknown";
    const likelihood = st.scheduledDate ? 100 : st.declinedDate ? 10 : 35;
    points.push({ match: Math.round(score), likelihood, company: String(company) });
  }
  return points.slice(0, 40);
}

export function computeAgentStatusPie(runs: ApplyRunSummary[], startDate: string, endDate: string): AgentStatusSlice[] {
  const counts = new Map<string, number>();
  for (const run of runs) {
    if (!isWithinRange(run.startedAt, startDate, endDate)) continue;
    const raw = (run.status || "other").toLowerCase();
    const key = raw.includes("applied") || raw.includes("success") ? "succeeded" : raw.includes("fail") ? "failed" : raw.includes("run") ? "running" : "other";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  if (total === 0) return [];
  return [...counts.entries()].map(([name, n]) => ({
    name: name.charAt(0).toUpperCase() + name.slice(1),
    v: Math.round((n / total) * 100),
    c: AGENT_STATUS_COLORS[name] ?? AGENT_STATUS_COLORS.other,
  }));
}

export function sumAppliedInRange(daily: DailyApplicationRow[]): number {
  return daily.reduce((a, r) => a + r.value, 0);
}

export function sumSourceTotals(summary: JobSourceSummaryRow[]) {
  return summary.reduce(
    (acc, r) => ({
      applied: acc.applied + r.applied,
      scheduled: acc.scheduled + r.scheduled,
      declined: acc.declined + r.declined,
      postings: acc.postings + r.postings,
    }),
    { applied: 0, scheduled: 0, declined: 0, postings: 0 },
  );
}
