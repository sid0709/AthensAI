import { JobSourceTitles } from "../../../data/jobs/pub";

export type AnalyticsRange = "7d" | "30d" | "90d" | "ytd" | "all" | "custom";

export type AnalyticsFilterState = {
  range: AnalyticsRange;
  /** Inclusive start day (`yyyy-MM-dd`) when `range` is `custom`. */
  customFrom: string;
  /** Inclusive end day (`yyyy-MM-dd`) when `range` is `custom`. */
  customTo: string;
  /** Empty = all sources. */
  source: string[];
};

export const DEFAULT_ANALYTICS_FILTERS: AnalyticsFilterState = {
  range: "30d",
  customFrom: "",
  customTo: "",
  source: [],
};

export const ANALYTICS_RANGE_OPTIONS: { value: AnalyticsRange; label: string }[] = [
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
  { value: "ytd", label: "YTD" },
  { value: "all", label: "All" },
  { value: "custom", label: "Custom" },
];

export const ANALYTICS_SOURCE_TITLES = JobSourceTitles as readonly string[];

export type AnalyticsFilterChip = {
  id: string;
  label: string;
  apply: (filters: AnalyticsFilterState) => AnalyticsFilterState;
};

export function countAnalyticsFilters(filters: AnalyticsFilterState): number {
  let n = 0;
  if (filters.source.length) n += 1;
  if (filters.range === "custom" && (filters.customFrom || filters.customTo)) n += 1;
  return n;
}

export function clearAnalyticsAttributeFilters(
  filters: AnalyticsFilterState,
): AnalyticsFilterState {
  return {
    ...filters,
    range: filters.range === "custom" ? "30d" : filters.range,
    customFrom: "",
    customTo: "",
    source: [],
  };
}

export function formatAnalyticsDayLabel(day: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return day || "…";
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(date.getTime())) return day;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function getAnalyticsFilterChips(
  filters: AnalyticsFilterState,
): AnalyticsFilterChip[] {
  const chips: AnalyticsFilterChip[] = [];
  for (const src of filters.source) {
    chips.push({
      id: `source-${src}`,
      label: src,
      apply: (next) => ({
        ...next,
        source: next.source.filter((value) => value !== src),
      }),
    });
  }
  if (filters.range === "custom" && (filters.customFrom || filters.customTo)) {
    chips.push({
      id: "custom-range",
      label: `${formatAnalyticsDayLabel(filters.customFrom)} – ${formatAnalyticsDayLabel(filters.customTo)}`,
      apply: (next) => ({
        ...next,
        range: "30d",
        customFrom: "",
        customTo: "",
      }),
    });
  }
  return chips;
}

export function isCatalogSource(source: string): boolean {
  return ANALYTICS_SOURCE_TITLES.includes(source);
}
