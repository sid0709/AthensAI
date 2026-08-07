import type { DailyPostingBySourceRow } from "../../../api/reports";

/** Stable palette for dynamic job sources (protocol colors, not domain labels). */
export const SOURCE_CHART_COLORS = [
  "#C0504D",
  "#9BBB59",
  "#8064A2",
  "#4F81BD",
  "#F59E0B",
  "#2DD4BF",
  "#EC4899",
  "#64748B",
] as const;

/** Max distinct source series on the stacked area chart; remainder folds into one bucket. */
export const MAX_POSTING_SOURCE_SERIES = 8;
export const OTHER_SOURCES_LABEL = "Other sources";

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

/** Pivot flat `{ date, source, count }` rows into stacked area chart points. */
export function pivotPostingsBySource(
  rows: DailyPostingBySourceRow[],
  startDate: string,
  endDate: string,
  maxSeries = MAX_POSTING_SOURCE_SERIES,
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

  const ranked = [...sourceTotals.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  const foldRemainder = ranked.length > maxSeries;
  const keepCount = foldRemainder ? Math.max(1, maxSeries - 1) : ranked.length;
  const keep = new Set(ranked.slice(0, keepCount).map(([s]) => s));

  if (foldRemainder) {
    for (const [date, day] of byDate) {
      let other = 0;
      for (const [source, count] of [...day.entries()]) {
        if (keep.has(source)) continue;
        other += count;
        day.delete(source);
      }
      if (other > 0) {
        day.set(OTHER_SOURCES_LABEL, (day.get(OTHER_SOURCES_LABEL) ?? 0) + other);
      }
      byDate.set(date, day);
    }
  }

  const sources = [
    ...ranked.filter(([s]) => keep.has(s)).map(([s]) => s),
    ...(foldRemainder ? [OTHER_SOURCES_LABEL] : []),
  ];

  if (sources.length === 0) {
    return { points: [], sources: [] };
  }

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

export function sourceChartColor(index: number): string {
  return SOURCE_CHART_COLORS[index % SOURCE_CHART_COLORS.length];
}
