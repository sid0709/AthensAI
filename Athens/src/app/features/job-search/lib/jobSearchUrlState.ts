import {
  DEFAULT_JOB_FILTERS,
  type JobSearchFilterState,
  type JobStatusTab,
} from "../../../hooks/useJobSearchFilters";
import {
  JOB_INDUSTRIES,
  JOB_LOCATIONS,
  JOB_SENIORITIES,
  JOB_WORK_MODES,
} from "../../../data/jobs";
import { JOB_TITLE_SCAN_ROLES } from "../../../data/jobTitleRoles";
import { JobSourceTitles } from "../../../data/jobs/pub";

export const JOB_SEARCH_PAGE_SIZES = [10, 25, 50, 100] as const;

export type JobSearchView = "list" | "grid";

export type JobSearchUrlState = {
  filters: JobSearchFilterState;
  page: number;
  pageSize: (typeof JOB_SEARCH_PAGE_SIZES)[number];
  view: JobSearchView;
  showScores: boolean;
  groupId: string;
  jobId: string;
};

export const DEFAULT_JOB_SEARCH_URL_STATE: JobSearchUrlState = {
  filters: {
    ...DEFAULT_JOB_FILTERS,
    source: [],
    seniority: [],
    titleRoles: [],
    scores: {
      overall: { ...DEFAULT_JOB_FILTERS.scores.overall },
      skill: { ...DEFAULT_JOB_FILTERS.scores.skill },
    },
  },
  page: 1,
  pageSize: 25,
  view: "list",
  showScores: false,
  groupId: "",
  jobId: "",
};

const STATUS_VALUES: readonly JobStatusTab[] = [
  "all",
  "posted",
  "bid-ready",
  "bid-completed",
  "applied",
  "scheduled",
  "declined",
];
const SORT_VALUES: readonly JobSearchFilterState["sort"][] = ["matchScore", "newest", "oldest", "title"];

function oneOf<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return value && allowed.includes(value as T) ? value as T : fallback;
}

function boolParam(value: string | null, fallback = false): boolean {
  if (value === "1") return true;
  if (value === "0") return false;
  return fallback;
}

function boundedInteger(value: string | null, fallback: number, min: number, max: number): number {
  const raw = String(value ?? "");
  if (!/^-?\d+$/.test(raw)) return fallback;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function validDate(value: string | null): string {
  const raw = String(value ?? "");
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return "";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? raw
    : "";
}

function multiParam(params: URLSearchParams, key: string, allowed: readonly string[]): string[] {
  const raw = params.getAll(key);
  if (!raw.length || raw.includes("all")) return [];
  const selected = new Set(raw);
  return allowed.filter((value) => selected.has(value));
}

function appendMulti(params: URLSearchParams, key: string, values: readonly string[]) {
  if (!values.length) {
    params.append(key, "all");
    return;
  }
  for (const value of values) params.append(key, value);
}

function normalizedScoreRange(minRaw: string | null, maxRaw: string | null) {
  const min = boundedInteger(minRaw, 0, 0, 100);
  const max = boundedInteger(maxRaw, 100, 0, 100);
  return min <= max ? { min, max } : { min: max, max: min };
}

export function parseJobSearchUrl(params: URLSearchParams): JobSearchUrlState {
  const source = multiParam(params, "source", JobSourceTitles);
  const seniority = multiParam(params, "seniority", JOB_SENIORITIES.filter((value) => value !== "all"));
  const titleRoles = multiParam(params, "role", JOB_TITLE_SCAN_ROLES);
  const requestedPageSize = boundedInteger(params.get("pageSize"), 25, 1, 100);
  const pageSize = JOB_SEARCH_PAGE_SIZES.includes(requestedPageSize as JobSearchUrlState["pageSize"])
    ? requestedPageSize as JobSearchUrlState["pageSize"]
    : 25;
  const groupId = params.get("group") ?? "";
  const jobId = groupId ? params.get("job") ?? "" : "";

  return {
    filters: {
      statusTab: oneOf(params.get("status"), STATUS_VALUES, "all"),
      jobQuery: params.get("q") ?? "",
      companyQuery: params.get("company") ?? "",
      source,
      location: oneOf(params.get("location"), JOB_LOCATIONS, "all"),
      workMode: oneOf(params.get("workMode"), JOB_WORK_MODES, "all"),
      seniority,
      titleRoles,
      industry: oneOf(params.get("industry"), JOB_INDUSTRIES, "all"),
      postedFrom: validDate(params.get("postedFrom")),
      postedTo: validDate(params.get("postedTo")),
      scores: {
        overall: normalizedScoreRange(params.get("overallMin"), params.get("overallMax")),
        skill: normalizedScoreRange(params.get("skillMin"), params.get("skillMax")),
      },
      sort: oneOf(params.get("sort"), SORT_VALUES, "matchScore"),
      aiExtractedOnly: boolParam(params.get("aiExtracted")),
      includeExternalScraped: boolParam(params.get("includeExternal")),
    },
    page: boundedInteger(params.get("page"), 1, 1, Number.MAX_SAFE_INTEGER),
    pageSize,
    view: oneOf(params.get("view"), ["list", "grid"] as const, "list"),
    showScores: boolParam(params.get("showScores")),
    groupId,
    jobId,
  };
}

export function serializeJobSearchUrl(state: JobSearchUrlState): URLSearchParams {
  const { filters } = state;
  const params = new URLSearchParams();
  params.set("status", filters.statusTab);
  params.set("q", filters.jobQuery);
  params.set("company", filters.companyQuery);
  appendMulti(params, "source", filters.source);
  params.set("location", filters.location);
  params.set("workMode", filters.workMode);
  appendMulti(params, "seniority", filters.seniority);
  appendMulti(params, "role", filters.titleRoles);
  params.set("industry", filters.industry);
  params.set("postedFrom", filters.postedFrom);
  params.set("postedTo", filters.postedTo);
  params.set("overallMin", String(filters.scores.overall.min));
  params.set("overallMax", String(filters.scores.overall.max));
  params.set("skillMin", String(filters.scores.skill.min));
  params.set("skillMax", String(filters.scores.skill.max));
  params.set("sort", filters.sort);
  params.set("aiExtracted", filters.aiExtractedOnly ? "1" : "0");
  params.set("includeExternal", filters.includeExternalScraped ? "1" : "0");
  params.set("page", String(state.page));
  params.set("pageSize", String(state.pageSize));
  params.set("view", state.view);
  params.set("showScores", state.showScores ? "1" : "0");
  params.set("group", state.groupId);
  params.set("job", state.groupId ? state.jobId : "");
  return params;
}

export function canonicalJobSearchQuery(params: URLSearchParams): string {
  return serializeJobSearchUrl(parseJobSearchUrl(params)).toString();
}

export function jobSearchFilterHistoryMode(
  previous: JobSearchFilterState,
  next: JobSearchFilterState,
): "push" | "replace" {
  const changed = (Object.keys(previous) as (keyof JobSearchFilterState)[])
    .filter((key) => JSON.stringify(previous[key]) !== JSON.stringify(next[key]));
  return changed.length > 0 && changed.every((key) => key === "jobQuery" || key === "companyQuery" || key === "scores")
    ? "replace"
    : "push";
}

export function jobSearchFilterTransition(
  state: JobSearchUrlState,
  filters: JobSearchFilterState,
) {
  const changed = JSON.stringify(state.filters) !== JSON.stringify(filters);
  return {
    state: changed ? { ...state, filters, page: 1, groupId: "", jobId: "" } : state,
    replace: jobSearchFilterHistoryMode(state.filters, filters) === "replace",
    changed,
  };
}

export function jobSearchPageSizeTransition(
  state: JobSearchUrlState,
  pageSize: JobSearchUrlState["pageSize"],
): JobSearchUrlState {
  return { ...state, pageSize, page: 1, groupId: "", jobId: "" };
}

export function mergeJobSearchState(
  base: JobSearchUrlState,
  patch: Partial<Omit<JobSearchUrlState, "filters">> & { filters?: Partial<JobSearchFilterState> },
): JobSearchUrlState {
  const nextFilters = patch.filters
    ? {
      ...base.filters,
      ...patch.filters,
      scores: patch.filters.scores
        ? { ...base.filters.scores, ...patch.filters.scores }
        : base.filters.scores,
    }
    : base.filters;
  return parseJobSearchUrl(serializeJobSearchUrl({ ...base, ...patch, filters: nextFilters }));
}

export function defaultJobSearchHref(filters: Partial<JobSearchFilterState> = {}): string {
  const state = mergeJobSearchState(DEFAULT_JOB_SEARCH_URL_STATE, { filters });
  return `/jobs?${serializeJobSearchUrl(state).toString()}`;
}
