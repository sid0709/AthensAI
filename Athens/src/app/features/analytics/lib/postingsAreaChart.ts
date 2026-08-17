import type { DailyPostingBySourceRow } from "../../../api/reports";
import { JobSourceTitles } from "../../../data/jobs/pub";

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
 * Pivot flat `{ date, source, count }` rows into daily points.
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
