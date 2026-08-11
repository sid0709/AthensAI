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

/** Max named series on the Lens stacked chart (plus a trailing Other bucket). */
export const POSTINGS_CHART_TOP_N = 7;

/** Aggregated remainder series key for the display chart (distinct from a real source named "Other"). */
export const POSTINGS_OTHER_KEY = "Other sources";

/**
 * Restrained Lens palette: brand blue for #1, then a short gray/blue ramp.
 * Index 0 is the largest source; last index should be reserved for Other.
 */
export const LENS_SERIES_COLORS = [
  "#1f6feb", // brand — top source
  "#4a8af0",
  "#7aa9f4",
  "#a3c4f7",
  "#8e8e8e",
  "#5d5d5d",
  "#3d3d3d",
  "#c7c7c7", // Other
] as const;

export type SourcePeriodTotal = {
  source: string;
  count: number;
  share: number;
};

/**
 * Period totals for every source present in the full pivot, sorted by volume desc.
 * Share is fraction of grand total (0–1).
 */
export function sourcePeriodTotals(
  points: PostingsAreaPoint[],
  sources: string[],
): SourcePeriodTotal[] {
  const counts = new Map<string, number>();
  let grand = 0;
  for (const source of sources) {
    let n = 0;
    for (const point of points) {
      n += Number(point[source]) || 0;
    }
    if (n <= 0) continue;
    counts.set(source, n);
    grand += n;
  }
  return [...counts.entries()]
    .map(([source, count]) => ({
      source,
      count,
      share: grand > 0 ? count / grand : 0,
    }))
    .sort(
      (a, b) => b.count - a.count || a.source.localeCompare(b.source),
    );
}

/**
 * Collapse a full source pivot into Top N named series + Other for the chart.
 * When `focusSource` is set and outside the natural top N, it is promoted into
 * the visible stack (bumping the smallest top source into Other).
 */
export function toTopNOtherSeries(
  points: PostingsAreaPoint[],
  sources: string[],
  topN: number = POSTINGS_CHART_TOP_N,
  focusSource: string | null = null,
): { points: PostingsAreaPoint[]; series: string[] } {
  const totals = sourcePeriodTotals(points, sources);
  if (totals.length === 0) {
    return { points: [], series: [] };
  }

  let named = totals.slice(0, topN).map((t) => t.source);
  if (focusSource && !named.includes(focusSource) && totals.some((t) => t.source === focusSource)) {
    named = [...named.slice(0, Math.max(0, topN - 1)), focusSource];
  }

  const namedSet = new Set(named);
  const hasOther = totals.some((t) => !namedSet.has(t.source));
  const series = hasOther ? [...named, POSTINGS_OTHER_KEY] : [...named];

  const displayPoints: PostingsAreaPoint[] = points.map((point) => {
    const next: PostingsAreaPoint = {
      date: point.date,
      label: point.label,
      total: Number(point.total) || 0,
    };
    let other = 0;
    for (const source of sources) {
      const n = Number(point[source]) || 0;
      if (namedSet.has(source)) {
        next[source] = n;
      } else {
        other += n;
      }
    }
    if (hasOther) {
      next[POSTINGS_OTHER_KEY] = other;
    }
    return next;
  });

  return { points: displayPoints, series };
}

/** Color for a Top-N + Other display series index (Other always uses the last ramp slot). */
export function lensSeriesColor(seriesKey: string, index: number, series: string[]): string {
  if (seriesKey === POSTINGS_OTHER_KEY) {
    return LENS_SERIES_COLORS[LENS_SERIES_COLORS.length - 1];
  }
  const namedCount = series.filter((s) => s !== POSTINGS_OTHER_KEY).length;
  if (namedCount <= 1) return LENS_SERIES_COLORS[0];
  const ramp = LENS_SERIES_COLORS.slice(0, LENS_SERIES_COLORS.length - 1);
  return ramp[Math.min(index, ramp.length - 1)];
}
