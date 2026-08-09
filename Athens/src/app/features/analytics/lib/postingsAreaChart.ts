import type { DailyPostingBySourceRow } from "../../../api/reports";
import { JobSourceTitles } from "../../../data/jobs/pub";

/**
 * Distinct chart colors for every catalog source (same order as Job Search).
 * Extra hues cover unknown/non-catalog labels without recycling early.
 */
export const SOURCE_CHART_COLORS = [
  "#2563EB", // LinkedIn
  "#DC2626", // Indeed
  "#0D9488", // ZipRecruiter
  "#7C3AED", // Wellfound
  "#EA580C", // Dice
  "#16A34A", // Greenhouse
  "#DB2777", // Workday
  "#0891B2", // Workable
  "#CA8A04", // Ashby
  "#4F46E5", // Lever
  "#E11D48", // Jobvite
  "#059669", // SmartRecruiters
  "#9333EA", // BambooHR
  "#0284C7", // Recruitee
  "#C026D3", // Teamtailor
  "#65A30D", // Personio
  "#F97316", // Rippling
  "#6366F1", // Dover
  "#14B8A6", // Applytojob
  "#F43F5E", // Jobdiva
  "#8B5CF6", // Breezy
  "#0EA5E9", // Gusto
  "#A855F7", // Rippling-ATS
  "#84CC16", // Pinpointhq
  "#EF4444", // Freshteam
  "#06B6D4", // Recruiterflow
  "#D946EF", // Gem
  "#F59E0B", // OracleCloud
  "#3B82F6", // Paylocity
  "#22C55E", // ADP
  "#EC4899", // iCIMS
  "#10B981", // UltiPro
  "#8B5CF6", // UKG
  "#F97316", // Paycom
  "#6366F1", // DayforceHCM
  "#14B8A6", // Zohorecruit
  "#EAB308", // BestJobTool
  "#64748B", // Taleo
  "#94A3B8", // Other
  "#FB7185",
  "#38BDF8",
  "#A3E635",
  "#C084FC",
  "#FDBA74",
  "#5EEAD4",
  "#F9A8D4",
] as const;

export type PostingsAreaPoint = {
  date: string;
  label: string;
  total: number;
} & Record<string, string | number>;

export function formatDayLabel(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Pivot flat `{ date, source, count }` rows into stacked area chart points.
 * Series = every source with data in range, ordered like Job Search catalog.
 */
export function pivotPostingsBySource(
  rows: DailyPostingBySourceRow[],
  startDate: string,
  endDate: string,
): { points: PostingsAreaPoint[]; sources: string[] } {
  const sourceTotals = new Map<string, number>();
  const byDate = new Map<string, Map<string, number>>();

  for (const row of rows) {
    const date = String(row.date || "").trim();
    const source = String(row.source || "").trim() || "Other";
    const count = Number(row.count) || 0;
    if (!date || count <= 0) continue;
    sourceTotals.set(source, (sourceTotals.get(source) ?? 0) + count);
    const day = byDate.get(date) ?? new Map<string, number>();
    day.set(source, (day.get(source) ?? 0) + count);
    byDate.set(date, day);
  }

  const present = [...sourceTotals.keys()];
  if (present.length === 0) {
    return { points: [], sources: [] };
  }

  const catalog = JobSourceTitles as readonly string[];
  const catalogSet = new Set(catalog);
  const sources = [
    ...catalog.filter((title) => sourceTotals.has(title)),
    ...present
      .filter((source) => !catalogSet.has(source))
      .sort(
        (a, b) =>
          (sourceTotals.get(b) ?? 0) - (sourceTotals.get(a) ?? 0) ||
          a.localeCompare(b),
      ),
  ];

  const start = startOfUtcDay(startDate);
  const end = startOfUtcDay(endDate);
  const points: PostingsAreaPoint[] = [];

  if (start && end && start <= end) {
    for (let t = start.getTime(); t <= end.getTime(); t += 86_400_000) {
      const date = new Date(t).toISOString().slice(0, 10);
      points.push(buildPoint(date, byDate.get(date), sources));
    }
  } else {
    for (const date of [...byDate.keys()].sort()) {
      points.push(buildPoint(date, byDate.get(date), sources));
    }
  }

  return { points, sources };
}

function buildPoint(
  date: string,
  day: Map<string, number> | undefined,
  sources: string[],
): PostingsAreaPoint {
  const point: PostingsAreaPoint = {
    date,
    label: formatDayLabel(date),
    total: 0,
  };
  for (const source of sources) {
    const n = day?.get(source) ?? 0;
    point[source] = n;
    point.total += n;
  }
  return point;
}

function startOfUtcDay(iso: string): Date | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Stable color for a source title (catalog index, then hash for unknowns). */
export function sourceChartColor(source: string, fallbackIndex = 0): string {
  const catalogIndex = (JobSourceTitles as readonly string[]).indexOf(source);
  if (catalogIndex >= 0) {
    return SOURCE_CHART_COLORS[catalogIndex % SOURCE_CHART_COLORS.length];
  }
  let hash = 0;
  for (let i = 0; i < source.length; i += 1) {
    hash = (hash * 31 + source.charCodeAt(i)) >>> 0;
  }
  return SOURCE_CHART_COLORS[
    (hash + fallbackIndex) % SOURCE_CHART_COLORS.length
  ];
}
