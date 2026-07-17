import { useState } from "react";

export type DateRange = "7d" | "30d" | "90d" | "ytd";

export function useAnalyticsFilters() {
  const [range, setRange] = useState<DateRange>("30d");
  return { range, setRange };
}

export const DATE_RANGE_OPTIONS: { value: DateRange; label: string }[] = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "ytd", label: "YTD" },
];
