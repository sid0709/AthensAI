import type { DateRange } from "../../../hooks/useAnalyticsFilters";

const RANGE_MONTHS: Record<DateRange, number> = {
  "7d": 1,
  "30d": 3,
  "90d": 5,
  ytd: 6,
};

const RANGE_SCALE: Record<DateRange, number> = {
  "7d": 0.22,
  "30d": 1,
  "90d": 2.8,
  ytd: 3.2,
};

export function sliceByRange<T>(data: T[], range: DateRange): T[] {
  const n = RANGE_MONTHS[range];
  return data.slice(-n);
}

export function scaleMetric(value: number, range: DateRange): number {
  return Math.round(value * RANGE_SCALE[range]);
}

export function rangeLabel(range: DateRange): string {
  return { "7d": "last 7 days", "30d": "last 30 days", "90d": "last 90 days", ytd: "year to date" }[range];
}
