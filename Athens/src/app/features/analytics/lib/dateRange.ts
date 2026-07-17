import type { DateRange } from "../../../hooks/useAnalyticsFilters";

export function rangeToIsoDates(range: DateRange): { startDate: string; endDate: string } {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date(end);
  if (range === "7d") start.setDate(start.getDate() - 6);
  else if (range === "30d") start.setDate(start.getDate() - 29);
  else if (range === "90d") start.setDate(start.getDate() - 89);
  else start.setMonth(0, 1);
  start.setHours(0, 0, 0, 0);
  return {
    startDate: start.toISOString(),
    endDate: end.toISOString(),
  };
}

export function isWithinRange(iso: string | undefined, startDate: string, endDate: string): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  return t >= new Date(startDate).getTime() && t <= new Date(endDate).getTime();
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
