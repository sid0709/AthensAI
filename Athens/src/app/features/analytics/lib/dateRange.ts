import type { DateRange } from "../../../hooks/useAnalyticsFilters";
import type { AnalyticsFilterState } from "./analyticsFilters";

export type AnalyticsDateBounds = {
  startDate: string;
  endDate: string;
  startDay: string;
  endDay: string;
};

export function startOfLocalDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

export function endOfLocalDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

export function toDayStamp(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function fromDayStamp(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : startOfLocalDay(date);
}

export function rangeToLocalDays(range: DateRange): { start: Date; end: Date } {
  const end = endOfLocalDay(new Date());
  const start = startOfLocalDay(end);
  if (range === "7d") start.setDate(start.getDate() - 6);
  else if (range === "30d") start.setDate(start.getDate() - 29);
  else if (range === "90d") start.setDate(start.getDate() - 89);
  else start.setMonth(0, 1);
  return { start, end };
}

export function rangeToIsoDates(range: DateRange): { startDate: string; endDate: string } {
  const { start, end } = rangeToLocalDays(range);
  return {
    startDate: start.toISOString(),
    endDate: end.toISOString(),
  };
}

export function defaultCustomSpan(): { from: string; to: string } {
  const { start, end } = rangeToLocalDays("30d");
  return { from: toDayStamp(start), to: toDayStamp(end) };
}

export function resolveAnalyticsBounds(filters: AnalyticsFilterState): AnalyticsDateBounds {
  if (filters.range === "all") {
    return { startDate: "", endDate: "", startDay: "", endDay: "" };
  }

  if (filters.range === "custom") {
    let from = fromDayStamp(filters.customFrom);
    let to = fromDayStamp(filters.customTo);
    if (!from && !to) {
      const fallback = rangeToLocalDays("30d");
      from = fallback.start;
      to = startOfLocalDay(fallback.end);
    } else if (!from && to) {
      from = to;
    } else if (from && !to) {
      to = from;
    }
    if (from && to && from > to) {
      const swap = from;
      from = to;
      to = swap;
    }
    const start = startOfLocalDay(from ?? new Date());
    const end = endOfLocalDay(to ?? new Date());
    return {
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      startDay: toDayStamp(start),
      endDay: toDayStamp(end),
    };
  }

  const { start, end } = rangeToLocalDays(filters.range);
  return {
    startDate: start.toISOString(),
    endDate: end.toISOString(),
    startDay: toDayStamp(start),
    endDay: toDayStamp(end),
  };
}

export function previousAnalyticsBounds(
  bounds: Pick<AnalyticsDateBounds, "startDate" | "endDate">,
): AnalyticsDateBounds | null {
  if (!bounds.startDate || !bounds.endDate) return null;
  const start = new Date(bounds.startDate).getTime();
  const end = new Date(bounds.endDate).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  const prevEnd = new Date(start - 1);
  const prevStart = new Date(prevEnd.getTime() - (end - start));
  return {
    startDate: prevStart.toISOString(),
    endDate: prevEnd.toISOString(),
    startDay: toDayStamp(prevStart),
    endDay: toDayStamp(prevEnd),
  };
}

export function isWithinRange(iso: string | undefined, startDate: string, endDate: string): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  if (!startDate && !endDate) return true;
  if (startDate && t < new Date(startDate).getTime()) return false;
  if (endDate && t > new Date(endDate).getTime()) return false;
  return true;
}

export function formatMonthLabel(dateStr: string): string {
  const d = new Date(dateStr.includes("T") ? dateStr : `${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, { month: "short" });
}

export function formatWeekLabel(date: Date): string {
  const jan1 = new Date(date.getFullYear(), 0, 1);
  const week = Math.ceil(((date.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7);
  return `W${week}`;
}

export function percentDelta(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

export function pointDelta(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  return Math.round(current - previous);
}
