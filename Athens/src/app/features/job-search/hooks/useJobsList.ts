import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useApi } from "@/api/useApi";
import { useApplier } from "@/context/applier-context";
import { API_BASE } from "@/lib/api-base";
import { retryTransient } from "@/lib/transient-retry";
import { mapDocToJob, normalizeId } from "../../../lib/job-adapters";
import type { CompanyJobGroup, Job } from "../../../types";
import { keepOnlyCompanyJob, removeCompanyJobs } from "../lib/companyGroupState";
import {
  extractRecommendSnapshot,
  mergeRecommendSnapshot,
  type JobRecommendSnapshot,
} from "../lib/jobRecommendSnapshot";
import type {
  JobSearchFilterState,
  JobStatusTab,
} from "../../../hooks/useJobSearchFilters";

type ListResponse = {
  success?: boolean;
  data?: Array<Record<string, unknown> & {
    companyId?: string;
    company?: { name?: string; logo?: string; url?: string };
    jobs?: Record<string, unknown>[];
    matchingJobCount?: number;
    matchingJobIds?: unknown[];
    companyMatchingCount?: number;
    nextMemberOffset?: number | null;
  }>;
  nextCursor?: string | null;
  hasMore?: boolean;
  pagination?: { total: number; totalJobs?: number; unit?: "companies" | "jobs"; page: number; limit: number; totalPages: number };
  readModelVersion?: string | null;
  statusCounts?: Partial<Record<JobStatusTab, number>> | null;
};

type ApiRequest = (
  path: string,
  options?: Omit<RequestInit, "body"> & { body?: unknown },
) => Promise<unknown>;

const EMPTY_STATUS_COUNTS: Record<JobStatusTab, number> = {
  all: 0,
  posted: 0,
  "bid-ready": 0,
  "worker-pool": 0,
  "bid-completed": 0,
  applied: 0,
  scheduled: 0,
  declined: 0,
};

const JOB_LIST_REQUEST_TIMEOUT_MS = 30_000;
const JOB_LIST_ENDPOINT = "/jobs";

const listRequests = new Map<string, Promise<ListResponse>>();

function requestJobsPage(
  requestKey: string,
  queryPath: string,
  request: ApiRequest,
): Promise<ListResponse> {
  const existing = listRequests.get(requestKey);
  if (existing) return existing;

  // This request belongs to the query key, not to any one React effect. A
  // rerender may stop consuming it, but must not abort it for another consumer.
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, JOB_LIST_REQUEST_TIMEOUT_MS);

  const pending = retryTransient(
    () => request(queryPath, {
      method: "GET",
      signal: controller.signal,
    }) as Promise<ListResponse>,
    { signal: controller.signal, delaysMs: [300] },
  ).catch((error: unknown) => {
    if (timedOut && (error as Error)?.name === "AbortError") {
      const timeoutError = new Error("Job Search request timed out");
      timeoutError.name = "TimeoutError";
      throw timeoutError;
    }
    throw error;
  }).finally(() => {
    clearTimeout(timeout);
    if (listRequests.get(requestKey) === pending) listRequests.delete(requestKey);
  });

  listRequests.set(requestKey, pending);
  return pending;
}

function statusTabToQuery(statusTab: JobStatusTab): string {
  return statusTab;
}

/** Debounce only free-text search fields; other filters apply immediately. */
function useDebouncedTextFilters(filters: JobSearchFilterState, delayMs = 400) {
  const [debouncedJobQuery, setDebouncedJobQuery] = useState(filters.jobQuery);
  const [debouncedCompanyQuery, setDebouncedCompanyQuery] = useState(filters.companyQuery);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedJobQuery(filters.jobQuery), delayMs);
    return () => clearTimeout(t);
  }, [filters.jobQuery, delayMs]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedCompanyQuery(filters.companyQuery), delayMs);
    return () => clearTimeout(t);
  }, [filters.companyQuery, delayMs]);

  const effectiveFilters = useMemo(
    () => ({
      ...filters,
      jobQuery: debouncedJobQuery,
      companyQuery: debouncedCompanyQuery,
    }),
    [filters, debouncedJobQuery, debouncedCompanyQuery],
  );

  return {
    filters: effectiveFilters,
    isDebouncing:
      filters.jobQuery !== debouncedJobQuery ||
      filters.companyQuery !== debouncedCompanyQuery,
  };
}

/** Build GET /jobs query string from Job Search URL-style filters. */
export function buildJobsListQuery(
  filters: JobSearchFilterState,
  opts: {
    page: number;
    pageSize: number;
    statusTab?: JobStatusTab;
    profileId?: string;
    applierName?: string;
  },
): string {
  const statusTab = opts.statusTab ?? filters.statusTab;
  const params = new URLSearchParams();
  params.set("status", statusTabToQuery(statusTab));
  params.set("q", filters.jobQuery.trim());
  params.set("company", filters.companyQuery.trim());
  params.set(
    "source",
    filters.source.length ? filters.source.join(",") : "all",
  );
  params.set("postedFrom", filters.postedFrom);
  params.set("postedTo", filters.postedTo);
  params.set("sort", filters.sort || "newest");
  params.set("aiExtracted", filters.aiExtractedOnly ? "1" : "0");
  params.set("page", String(opts.page));
  params.set("pageSize", String(opts.pageSize));
  if (opts.profileId) params.set("profileId", opts.profileId);
  const applierName = String(opts.applierName || "").trim();
  if (applierName) params.set("applierName", applierName);
  return `${JOB_LIST_ENDPOINT}?${params.toString()}`;
}

function applyRecommendCache(
  groups: CompanyJobGroup[],
  cache: Map<string, JobRecommendSnapshot>,
): CompanyJobGroup[] {
  return groups.map((group) => ({
    ...group,
    jobs: group.jobs.map((job) => {
      const id = String(job.backendId || job.id || "").trim();
      const merged = mergeRecommendSnapshot(job, id ? cache.get(id) : null);
      const snap = extractRecommendSnapshot(merged);
      if (snap && id) cache.set(id, snap);
      return merged;
    }),
  }));
}

function asIdList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const ids = value.map((id) => normalizeId(id).trim()).filter(Boolean);
  return ids.length ? ids : undefined;
}

function mapResponseGroups(
  rows: NonNullable<ListResponse["data"]>,
  applier: ReturnType<typeof useApplier>["applier"],
): CompanyJobGroup[] {
  const groups: CompanyJobGroup[] = [];
  const groupIndexes = new Map<string, number>();
  for (const row of rows) {
    if (Array.isArray(row.jobs)) {
      const companyId = normalizeId(row.companyId) || "";
      const jobs = row.jobs.map((doc) => {
        const mapped = mapDocToJob(doc, applier);
        return companyId && mapped.companyId !== companyId
          ? { ...mapped, companyId }
          : mapped;
      });
      const first = jobs[0];
      groups.push({
        companyId: companyId || first?.companyId || `legacy:${first?.id || "unknown"}`,
        company: {
          name: String(row.company?.name || first?.company || "Unknown"),
          logoUrl: String(row.company?.logo || first?.logoUrl || "") || undefined,
          url: String(row.company?.url || first?.companyUrl || "") || undefined,
        },
        jobs,
        matchingJobCount: typeof row.matchingJobCount === "number" ? row.matchingJobCount : undefined,
        matchingJobIds: asIdList(row.matchingJobIds),
        nextMemberOffset: row.nextMemberOffset ?? undefined,
        memberOrder: Object.fromEntries(jobs.map((job, index) => [job.id, index])),
      });
      continue;
    }
    const job = mapDocToJob(row, applier);
    const index = groupIndexes.get(job.companyId);
    if (index === undefined) {
      groupIndexes.set(job.companyId, groups.length);
      groups.push({
        companyId: job.companyId,
        company: { name: job.company, logoUrl: job.logoUrl, url: job.companyUrl },
        jobs: [job],
        matchingJobCount: Math.max(1, Number(row.companyMatchingCount || 1)),
        memberOrder: { [job.id]: 0 },
      });
    } else {
      groups[index].jobs.push(job);
      groups[index].matchingJobCount = Math.max(
        groups[index].matchingJobCount || 1,
        Number(row.companyMatchingCount || 1),
      );
      groups[index].memberOrder = {
        ...groups[index].memberOrder,
        [job.id]: groups[index].jobs.length - 1,
      };
    }
  }
  for (const group of groups) {
    group.nextMemberOffset = (group.matchingJobCount || group.jobs.length) > group.jobs.length
      ? group.jobs.length
      : null;
  }
  return groups;
}

export function useJobsList(
  filters: JobSearchFilterState,
  excludeIds: Set<string> = new Set(),
  page = 1,
  pageSize = 25,
) {
  const { request } = useApi(API_BASE);
  const { applier, applierReady } = useApplier();

  const [rawGroups, setRawGroups] = useState<CompanyJobGroup[]>([]);
  const [total, setTotal] = useState(0);
  const [totalJobs, setTotalJobs] = useState(0);
  const [memberLoadingIds, setMemberLoadingIds] = useState<Set<string>>(new Set());
  const [memberErrors, setMemberErrors] = useState<Record<string, string>>({});
  const memberRequestTokensRef = useRef(new Map<string, symbol>());
  const memberCursorsRef = useRef(new Map<string, string | null>());
  const [requestInFlight, setRequestInFlight] = useState(false);
  const [settledKey, setSettledKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryRevision, setRetryRevision] = useState(0);
  const [statusCounts, setStatusCounts] = useState(EMPTY_STATUS_COUNTS);
  const rawGroupsRef = useRef<CompanyJobGroup[]>([]);
  const recommendCacheRef = useRef(new Map<string, JobRecommendSnapshot>());
  const applierRef = useRef(applier);
  rawGroupsRef.current = rawGroups;
  applierRef.current = applier;

  const {
    filters: debouncedFilters,
    isDebouncing,
  } = useDebouncedTextFilters(filters);
  const groups = useMemo(
    () => rawGroups
      .map((group) => ({ ...group, jobs: group.jobs.filter((job) => !excludeIds.has(job.id)) }))
      .filter((group) => group.jobs.length > 0),
    [rawGroups, excludeIds],
  );
  const jobs = useMemo(() => groups.flatMap((group) => group.jobs), [groups]);

  const listQueryPath = useMemo(
    () =>
      buildJobsListQuery(debouncedFilters, {
        page,
        pageSize,
        profileId: applier?._id != null ? normalizeId(applier._id) : undefined,
        applierName: applier?.name,
      }),
    [debouncedFilters, page, pageSize, applier?._id, applier?.name],
  );

  const currentQueryKey = listQueryPath;
  const loading =
    !applierReady ||
    isDebouncing ||
    requestInFlight ||
    settledKey !== currentQueryKey;

  useEffect(() => {
    recommendCacheRef.current.clear();
  }, [applier?._id]);

  useEffect(() => {
    memberRequestTokensRef.current.clear();
    memberCursorsRef.current.clear();
    setMemberLoadingIds(new Set());
    setMemberErrors({});
  }, [currentQueryKey]);

  useEffect(() => {
    if (!applierReady || isDebouncing) return;
    let cancelled = false;
    const applyResponse = (res: ListResponse, { allowEmptyMidPage = false } = {}) => {
      if (!res?.success || !Array.isArray(res.data)) return false;
      const tab = debouncedFilters.statusTab;
      const countTotal = res.statusCounts
        ? Number(
            tab === "all"
              ? res.statusCounts.all
              : tab === "posted"
                ? res.statusCounts.posted
                : res.statusCounts[tab],
          ) || 0
        : null;
      const responseTotal = res.pagination?.total
        ?? countTotal
        ?? ((page - 1) * pageSize + res.data.length + (res.hasMore ? 1 : 0));
      if (
        !allowEmptyMidPage
        && page > 1
        && res.data.length === 0
        && responseTotal > (page - 1) * pageSize
      ) {
        return false;
      }
      setRawGroups(
        applyRecommendCache(
          mapResponseGroups(res.data, applierRef.current),
          recommendCacheRef.current,
        ),
      );
      setTotal(responseTotal);
      setTotalJobs(res.pagination?.totalJobs ?? countTotal ?? responseTotal);
      if (res.statusCounts) {
        setStatusCounts({ ...EMPTY_STATUS_COUNTS, ...res.statusCounts });
      }
      setSettledKey(currentQueryKey);
      return true;
    };
    setRequestInFlight(true);
    setError(null);
    setRawGroups([]);
    setTotal(0);
    setTotalJobs(0);
    setSettledKey(null);

    (async () => {
      try {
        const res = await requestJobsPage(currentQueryKey, listQueryPath, request);
        if (cancelled) return;
        if (!applyResponse(res)) {
          throw new Error("The jobs response was incomplete");
        }
      } catch (e) {
        const timedOut = (e as Error)?.name === "TimeoutError";
        if ((e as Error)?.name === "AbortError") return;
        console.error(e);
        if (cancelled) return;
        setRawGroups([]);
        setTotal(0);
        setTotalJobs(0);
        setSettledKey(currentQueryKey);
        setError(timedOut
          ? "Job Search took too long to respond. Please try again."
          : "Could not load jobs. Check the server connection and try again.");
        toast.error("Failed to load jobs", {
          description: timedOut
            ? "The request timed out. Please try again."
            : "Check that athens-backend is running and VITE_API_URL is set.",
        });
      } finally {
        if (!cancelled) setRequestInFlight(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentQueryKey, retryRevision, request, applierReady, isDebouncing, listQueryPath, page, pageSize, debouncedFilters.statusTab]);
  const patchJob = useCallback(
    (updated: Job) => {
      const snap = extractRecommendSnapshot(updated);
      if (snap) {
        const id = String(updated.backendId || updated.id || "").trim();
        if (id) recommendCacheRef.current.set(id, snap);
      }
      const previousJob = rawGroupsRef.current
        .flatMap((group) => group.jobs)
        .find((job) => job.id === updated.id || job.backendId === updated.backendId);
      if (previousJob && previousJob.status !== updated.status) {
        setStatusCounts((previous) => ({
          ...previous,
          [previousJob.status]: Math.max(0, previous[previousJob.status] - 1),
          [updated.status]: previous[updated.status] + 1,
        }));
      }
      const statusTab = debouncedFilters.statusTab;
      setRawGroups((previous) => {
        if (statusTab !== "all" && updated.status !== statusTab) {
          const result = removeCompanyJobs(
            previous,
            (job) => job.id === updated.id || job.backendId === updated.backendId,
          );
          if (result.removedGroups) setTotal((value) => Math.max(0, value - result.removedGroups));
          if (result.removedJobs) setTotalJobs((value) => Math.max(0, value - result.removedJobs));
          if (result.needsDirectoryRefresh) queueMicrotask(() => setRetryRevision((revision) => revision + 1));
          return result.groups;
        }
        return previous.map((group) => ({
          ...group,
          jobs: group.jobs.map((job) =>
            job.id === updated.id || job.backendId === updated.backendId ? updated : job),
        }));
      });
    },
    [debouncedFilters.statusTab],
  );

  const removeJobsById = useCallback((ids: string[]) => {
    if (!ids.length) return;
    const idSet = new Set(ids);
    setRawGroups((previous) => {
      const result = removeCompanyJobs(
        previous,
        (job) => idSet.has(job.id) || idSet.has(job.backendId || ""),
      );
      if (result.removedGroups) setTotal((value) => Math.max(0, value - result.removedGroups));
      if (result.removedJobs) setTotalJobs((value) => Math.max(0, value - result.removedJobs));
      if (result.needsDirectoryRefresh) queueMicrotask(() => setRetryRevision((revision) => revision + 1));
      return result.groups;
    });
  }, []);

  const markJobsApplied = useCallback((ids: string[]) => {
    if (!ids.length) return;
    const idSet = new Set(ids);
    const statusTab = debouncedFilters.statusTab;
    setRawGroups((previous) => {
      if (statusTab !== "all") {
        const result = removeCompanyJobs(
          previous,
          (job) => idSet.has(job.id) || idSet.has(job.backendId || ""),
        );
        if (result.removedGroups) setTotal((value) => Math.max(0, value - result.removedGroups));
        if (result.removedJobs) setTotalJobs((value) => Math.max(0, value - result.removedJobs));
        return result.groups;
      }
      return previous.map((group) => ({
        ...group,
        jobs: group.jobs.map((job) =>
          idSet.has(job.id) || idSet.has(job.backendId || "")
            ? { ...job, status: "applied" as const }
            : job,
        ),
        matchingJobIds: group.matchingJobIds?.filter((id) => !idSet.has(id)),
      }));
    });
  }, [debouncedFilters.statusTab]);

  const removeOtherCompanyJobs = useCallback((companyId: string, keepJobId: string) => {
    setRawGroups((previous) => {
      const result = keepOnlyCompanyJob(previous, companyId, keepJobId);
      if (result.removedJobs) {
        setTotalJobs((value) => Math.max(0, value - result.removedJobs));
      }
      return result.groups;
    });
  }, []);

  const refreshStatusCounts = useCallback(async () => {
    if (!applierReady) return;
    try {
      const res = (await request(listQueryPath, { method: "GET" })) as ListResponse;
      if (res?.success && res.statusCounts) {
        setStatusCounts({ ...EMPTY_STATUS_COUNTS, ...res.statusCounts });
      }
    } catch {
      /* counts are optional */
    }
  }, [applierReady, listQueryPath, request]);

  const retry = useCallback(() => {
    setError(null);
    setRequestInFlight(true);
    setRetryRevision((revision) => revision + 1);
  }, []);

  const loadCompanyMembers = useCallback(async (
    companyId: string,
    options: { focusJobId?: string } = {},
  ) => {
    const group = rawGroups.find((candidate) => candidate.companyId === companyId);
    if (!group || memberLoadingIds.has(companyId)) return;
    const focusLoaded = !options.focusJobId || group.jobs.some((job) => job.id === options.focusJobId);
    if (group.nextMemberOffset == null && focusLoaded) return;
    // Company member paging is not part of the athens-backend GET /jobs MVP.
    return { focusValid: focusLoaded };
  }, [memberLoadingIds, rawGroups]);

  return {
    jobs,
    groups,
    total,
    totalJobs,
    loading,
    error,
    retry,
    requestKey: currentQueryKey,
    resultsSettled: settledKey === currentQueryKey,
    countsLoading: loading,
    page,
    pageSize,
    statusCounts,
    applierReady,
    patchJob,
    markJobsApplied,
    removeJobsById,
    removeOtherCompanyJobs,
    loadCompanyMembers,
    memberLoadingIds,
    memberErrors,
    refreshStatusCounts,
  };
}
