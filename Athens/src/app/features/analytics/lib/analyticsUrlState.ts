import { JobSourceTitles } from "../../../data/jobs/pub";
import {
  DEFAULT_ANALYTICS_FILTERS,
  type AnalyticsFilterState,
  type AnalyticsRange,
} from "./analyticsFilters";

const RANGE_VALUES: readonly AnalyticsRange[] = [
  "7d",
  "30d",
  "90d",
  "ytd",
  "all",
  "custom",
];

function oneOf<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return value && allowed.includes(value as T) ? (value as T) : fallback;
}

function validDate(value: string | null): string {
  const raw = String(value ?? "");
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return "";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    ? raw
    : "";
}

function parseSources(params: URLSearchParams): string[] {
  const allowed = JobSourceTitles as readonly string[];
  const raw = params.getAll("source");
  if (!raw.length || raw.includes("all")) return [];
  const selected = new Set(raw);
  return allowed.filter((value) => selected.has(value));
}

export function parseAnalyticsUrl(params: URLSearchParams): AnalyticsFilterState {
  const range = oneOf(params.get("range"), RANGE_VALUES, DEFAULT_ANALYTICS_FILTERS.range);
  const customFrom = range === "custom" ? validDate(params.get("from")) : "";
  const customTo = range === "custom" ? validDate(params.get("to")) : "";
  return {
    range,
    customFrom,
    customTo,
    source: parseSources(params),
  };
}

export function serializeAnalyticsUrl(filters: AnalyticsFilterState): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.range !== DEFAULT_ANALYTICS_FILTERS.range) {
    params.set("range", filters.range);
  }
  if (filters.range === "custom") {
    if (filters.customFrom) params.set("from", filters.customFrom);
    if (filters.customTo) params.set("to", filters.customTo);
  }
  for (const source of filters.source) params.append("source", source);
  return params;
}

export function canonicalAnalyticsQuery(params: URLSearchParams): string {
  return serializeAnalyticsUrl(parseAnalyticsUrl(params)).toString();
}
