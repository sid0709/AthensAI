import { useMemo } from "react";
import type { Job, JobStatus } from "../types/job";
import { JOBS } from "../data/jobs";

export type JobSortKey =
  | "newest"
  | "matchScore"
  | "title";

export type JobStatusTab = "all" | JobStatus;

export type ScoreRange = { min: number; max: number };

export type JobScoreFilters = {
  overall: ScoreRange;
  skill: ScoreRange;
};

export type JobSearchFilterState = {
  statusTab: JobStatusTab;
  jobQuery: string;
  companyQuery: string;
  /** Empty = all sources */
  source: string[];
  location: string;
  workMode: string;
  /** Empty = all seniority levels */
  seniority: string[];
  industry: string;
  postedFrom: string;
  postedTo: string;
  scores: JobScoreFilters;
  sort: JobSortKey;
  /** Show only jobs whose skills have been AI-extracted. */
  aiExtractedOnly: boolean;
  /** Legacy flag: external_scraped_jobs merge (off — job_market is the sole catalog). */
  includeExternalScraped: boolean;
};

export const DEFAULT_SCORE_RANGE: ScoreRange = { min: 0, max: 100 };

export const DEFAULT_JOB_FILTERS: JobSearchFilterState = {
  statusTab: "all",
  jobQuery: "",
  companyQuery: "",
  source: [],
  location: "all",
  workMode: "all",
  seniority: [],
  industry: "all",
  postedFrom: "",
  postedTo: "",
  scores: {
    overall: { ...DEFAULT_SCORE_RANGE },
    skill: { ...DEFAULT_SCORE_RANGE },
  },
  sort: "matchScore",
  aiExtractedOnly: false,
  includeExternalScraped: false,
};

function inScoreRange(value: number, range: ScoreRange) {
  return value >= range.min && value <= range.max;
}

function matchesBaseFilters(job: Job, filters: JobSearchFilterState, includeStatus: boolean) {
  if (includeStatus && filters.statusTab !== "all" && job.status !== filters.statusTab) return false;
  if (filters.source.length && !filters.source.includes(job.source)) return false;
  if (filters.location !== "all" && job.location !== filters.location) return false;
  if (filters.workMode !== "all" && job.workMode !== filters.workMode) return false;
  if (
    filters.seniority.length &&
    !filters.seniority.some((s) => job.seniority.toLowerCase().includes(s.toLowerCase()))
  ) {
    return false;
  }
  if (filters.industry !== "all" && !job.industries.includes(filters.industry)) return false;

  if (filters.jobQuery.trim()) {
    const q = filters.jobQuery.toLowerCase();
    if (!job.title.toLowerCase().includes(q)) return false;
  }

  if (filters.companyQuery.trim()) {
    const q = filters.companyQuery.toLowerCase();
    if (!job.company.toLowerCase().includes(q)) return false;
  }

  if (filters.postedFrom && job.postedAt < filters.postedFrom) return false;
  if (filters.postedTo && job.postedAt > filters.postedTo) return false;

  const { scores } = job;
  if (!inScoreRange(scores.overall, filters.scores.overall)) return false;
  if (!inScoreRange(scores.skill, filters.scores.skill)) return false;

  return true;
}

function sortJobs(jobs: Job[], sort: JobSortKey) {
  return [...jobs].sort((a, b) => {
    switch (sort) {
      case "newest":
        return b.postedAt.localeCompare(a.postedAt);
      case "matchScore":
        return b.scores.overall - a.scores.overall;
      case "title":
        return a.title.localeCompare(b.title);
      default:
        return 0;
    }
  });
}

export function filterJobs(
  jobs: Job[],
  filters: JobSearchFilterState,
  excludeIds: Set<string> = new Set(),
) {
  const filtered = jobs.filter(
    (job) => !excludeIds.has(job.id) && matchesBaseFilters(job, filters, true),
  );
  return sortJobs(filtered, filters.sort);
}

export function countJobsByStatus(
  jobs: Job[],
  filters: JobSearchFilterState,
  excludeIds: Set<string> = new Set(),
): Record<JobStatusTab, number> {
  const base = jobs.filter(
    (job) => !excludeIds.has(job.id) && matchesBaseFilters(job, filters, false),
  );

  return {
    all: base.length,
    posted: base.filter((j) => j.status === "posted").length,
    "bid-ready": base.filter((j) => j.status === "bid-ready").length,
    "bid-completed": base.filter((j) => j.status === "bid-completed").length,
    applied: base.filter((j) => j.status === "applied").length,
    scheduled: base.filter((j) => j.status === "scheduled").length,
    declined: base.filter((j) => j.status === "declined").length,
  };
}

export function countActiveFilters(filters: JobSearchFilterState): number {
  return countAttributeFilters(filters) + countScoreFilters(filters);
}

export function countAttributeFilters(filters: JobSearchFilterState): number {
  let n = 0;
  if (filters.source.length) n++;
  if (filters.location !== "all") n++;
  if (filters.workMode !== "all") n++;
  if (filters.seniority.length) n++;
  if (filters.industry !== "all") n++;
  if (filters.postedFrom || filters.postedTo) n++;
  return n;
}

export function countScoreFilters(filters: JobSearchFilterState): number {
  let n = 0;
  for (const key of Object.keys(filters.scores) as (keyof JobScoreFilters)[]) {
    const r = filters.scores[key];
    if (r.min !== 0 || r.max !== 100) n++;
  }
  return n;
}

export function clearAttributeFilters(filters: JobSearchFilterState): JobSearchFilterState {
  return {
    ...filters,
    source: [],
    location: "all",
    workMode: "all",
    seniority: [],
    industry: "all",
    postedFrom: "",
    postedTo: "",
  };
}

export function clearScoreFilters(filters: JobSearchFilterState): JobSearchFilterState {
  return {
    ...filters,
    scores: {
      overall: { ...DEFAULT_SCORE_RANGE },
      skill: { ...DEFAULT_SCORE_RANGE },
    },
  };
}

export function clearAllFilters(filters: JobSearchFilterState): JobSearchFilterState {
  return clearScoreFilters(clearAttributeFilters({ ...filters, jobQuery: "", companyQuery: "" }));
}

export type ActiveFilterChip = {
  id: string;
  label: string;
  apply: (filters: JobSearchFilterState) => JobSearchFilterState;
};

export function getActiveFilterChips(filters: JobSearchFilterState): ActiveFilterChip[] {
  const chips: ActiveFilterChip[] = [];

  if (filters.jobQuery.trim()) {
    chips.push({
      id: "jobQuery",
      label: `Role: ${filters.jobQuery}`,
      apply: (f) => ({ ...f, jobQuery: "" }),
    });
  }
  if (filters.companyQuery.trim()) {
    chips.push({
      id: "companyQuery",
      label: `Company: ${filters.companyQuery}`,
      apply: (f) => ({ ...f, companyQuery: "" }),
    });
  }
  for (const src of filters.source) {
    chips.push({
      id: `source-${src}`,
      label: `Source: ${src}`,
      apply: (f) => ({ ...f, source: f.source.filter((s) => s !== src) }),
    });
  }
  if (filters.location !== "all") {
    chips.push({
      id: "location",
      label: filters.location,
      apply: (f) => ({ ...f, location: "all" }),
    });
  }
  if (filters.workMode !== "all") {
    chips.push({
      id: "workMode",
      label: filters.workMode,
      apply: (f) => ({ ...f, workMode: "all" }),
    });
  }
  for (const level of filters.seniority) {
    chips.push({
      id: `seniority-${level}`,
      label: level,
      apply: (f) => ({ ...f, seniority: f.seniority.filter((s) => s !== level) }),
    });
  }
  if (filters.industry !== "all") {
    chips.push({
      id: "industry",
      label: filters.industry,
      apply: (f) => ({ ...f, industry: "all" }),
    });
  }
  if (filters.postedFrom || filters.postedTo) {
    chips.push({
      id: "posted",
      label: `Posted ${filters.postedFrom || "…"} – ${filters.postedTo || "…"}`,
      apply: (f) => ({ ...f, postedFrom: "", postedTo: "" }),
    });
  }

  const scoreLabels: Record<keyof JobScoreFilters, string> = {
    overall: "Overall",
    skill: "Skill",
  };

  for (const key of Object.keys(filters.scores) as (keyof JobScoreFilters)[]) {
    const r = filters.scores[key];
    if (r.min !== 0 || r.max !== 100) {
      chips.push({
        id: `score-${key}`,
        label: `${scoreLabels[key]} ${r.min}–${r.max}`,
        apply: (f) => ({
          ...f,
          scores: { ...f.scores, [key]: { ...DEFAULT_SCORE_RANGE } },
        }),
      });
    }
  }

  return chips;
}

export function useJobSearchResults(
  filters: JobSearchFilterState,
  excludeIds: Set<string> = new Set(),
) {
  return useMemo(() => {
    const results = filterJobs(JOBS, filters, excludeIds);
    const statusCounts = countJobsByStatus(JOBS, filters, excludeIds);
    return { results, statusCounts, total: results.length };
  }, [filters, excludeIds]);
}

/** @deprecated use useJobSearchResults */
export function useJobSearchFilters(
  search: string,
  status: string,
  source: string,
  location: string,
  sort: JobSortKey,
) {
  const filters: JobSearchFilterState = {
    ...DEFAULT_JOB_FILTERS,
    jobQuery: search,
    companyQuery: "",
    statusTab: status === "all" ? "all" : (status as JobStatusTab),
    source: source ? [source] : [],
    location,
    sort: sort === "posted" ? "newest" : sort,
  };
  return filterJobs(JOBS, filters);
}

export function jobSearchFilterFn(job: Job, query: string) {
  return (
    job.title.toLowerCase().includes(query) ||
    job.company.toLowerCase().includes(query) ||
    job.location.toLowerCase().includes(query)
  );
}

export function exportJobsCsv(jobs: Job[]): string {
  const header = "Link,Title,Company,Location,Status,Match,Skill,Posted,Salary,Source";
  const rows = jobs.map((j) =>
    [
      j.applyUrl,
      j.title,
      j.company,
      j.location,
      j.status,
      j.scores.overall,
      j.scores.skill,
      j.postedAt,
      j.salary,
      j.source,
    ]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(","),
  );
  return [header, ...rows].join("\n");
}

export function downloadJobsCsv(jobs: Job[], filename = "jobs-export.csv") {
  const blob = new Blob([exportJobsCsv(jobs)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
