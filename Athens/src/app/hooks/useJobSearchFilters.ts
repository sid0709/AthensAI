import { useMemo } from "react";
import type { Job, JobStatus } from "../types/job";
import { JOBS } from "../data/jobs";

export type JobSortKey = "newest";

export type JobStatusTab = "all" | JobStatus;

export type JobSearchFilterState = {
  statusTab: JobStatusTab;
  jobQuery: string;
  companyQuery: string;
  /** Empty = all sources */
  source: string[];
  postedFrom: string;
  postedTo: string;
  sort: JobSortKey;
  /** Show only jobs whose skills have been AI-extracted. */
  aiExtractedOnly: boolean;
  /** Legacy flag: external_scraped_jobs merge (off — job_market is the sole catalog). */
  includeExternalScraped: boolean;
};

export const DEFAULT_JOB_FILTERS: JobSearchFilterState = {
  statusTab: "all",
  jobQuery: "",
  companyQuery: "",
  source: [],
  postedFrom: "",
  postedTo: "",
  sort: "newest",
  aiExtractedOnly: false,
  includeExternalScraped: false,
};

function matchesBaseFilters(job: Job, filters: JobSearchFilterState, includeStatus: boolean) {
  if (includeStatus && filters.statusTab !== "all" && job.status !== filters.statusTab) return false;
  if (filters.source.length && !filters.source.includes(job.source)) return false;

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

  return true;
}

function sortJobs(jobs: Job[], _sort: JobSortKey) {
  return [...jobs].sort((a, b) => {
    return b.postedAt.localeCompare(a.postedAt) || b.id.localeCompare(a.id);
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
    "worker-pool": base.filter((j) => j.status === "worker-pool").length,
    "bid-completed": base.filter((j) => j.status === "bid-completed").length,
    applied: base.filter((j) => j.status === "applied").length,
    scheduled: base.filter((j) => j.status === "scheduled").length,
    declined: base.filter((j) => j.status === "declined").length,
  };
}

export function countActiveFilters(filters: JobSearchFilterState): number {
  return countAttributeFilters(filters);
}

export function countAttributeFilters(filters: JobSearchFilterState): number {
  let n = 0;
  if (filters.source.length) n++;
  if (filters.postedFrom || filters.postedTo) n++;
  return n;
}

export function clearAttributeFilters(filters: JobSearchFilterState): JobSearchFilterState {
  return {
    ...filters,
    source: [],
    postedFrom: "",
    postedTo: "",
  };
}

export function clearAllFilters(filters: JobSearchFilterState): JobSearchFilterState {
  return clearAttributeFilters({ ...filters, jobQuery: "", companyQuery: "" });
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
  if (filters.postedFrom || filters.postedTo) {
    chips.push({
      id: "posted",
      label: `Posted ${filters.postedFrom || "…"} – ${filters.postedTo || "…"}`,
      apply: (f) => ({ ...f, postedFrom: "", postedTo: "" }),
    });
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
  _location: string,
  sort: JobSortKey | "posted",
) {
  const filters: JobSearchFilterState = {
    ...DEFAULT_JOB_FILTERS,
    jobQuery: search,
    companyQuery: "",
    statusTab: status === "all" ? "all" : (status as JobStatusTab),
    source: source ? [source] : [],
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
  const header = "Link,Title,Company,Location,Status,Posted,Salary,Source";
  const rows = jobs.map((j) =>
    [
      j.applyUrl,
      j.title,
      j.company,
      j.location,
      j.status,
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
