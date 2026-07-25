import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useApi } from "@/api/useApi";
import { useApplier } from "@/context/applier-context";
import { API_BASE } from "@/lib/api-base";
import { JobSourceTitles } from '@/app/data/jobs/pub';
import { JOB_TITLE_SCAN_ROLES } from "@/app/data/jobTitleRoles";
import { mapDocToJob, SORT_TO_API } from "../../../lib/job-adapters";
import { rescoreJobWithContext, type ProfileMatchContext } from "../../../lib/skill-match";
import type {
  JobSearchFilterState,
  JobScoreFilters,
  JobStatusTab,
} from "../../../hooks/useJobSearchFilters";
import type { Job } from "../../../types";

type ListResponse = {
  success?: boolean;
  data?: Record<string, unknown>[];
  recommendationFallback?: boolean;
  recommendationReason?: string | null;
  recommendationWarming?: boolean;
  catalogTotal?: number | null;
  pagination?: { total: number; page: number; limit: number; totalPages: number };
  rankingVersion?: string | null;
  rankingStatus?: "fresh" | "warming" | "fallback" | "legacy" | null;
  catalogRevision?: string | null;
  personalizedThroughRank?: number | null;
  statusCounts?: Partial<Record<JobStatusTab, number>> | null;
};

type CountsResponse = {
  success?: boolean;
  counts?: Partial<Record<JobStatusTab, number>>;
};

const EMPTY_STATUS_COUNTS: Record<JobStatusTab, number> = {
  all: 0,
  posted: 0,
  "bid-ready": 0,
  "bid-completed": 0,
  applied: 0,
  scheduled: 0,
  declined: 0,
};

const LIST_CACHE_TTL_MS = 60_000;
const LIST_CACHE_MAX_ENTRIES = 200;
const listCache = new Map<string, { response: ListResponse; expiresAt: number }>();

function cacheListResponse(key: string, response: ListResponse) {
  const now = Date.now();
  for (const [existingKey, entry] of listCache) {
    if (entry.expiresAt <= now) listCache.delete(existingKey);
  }
  listCache.delete(key);
  listCache.set(key, { response, expiresAt: now + LIST_CACHE_TTL_MS });
  while (listCache.size > LIST_CACHE_MAX_ENTRIES) {
    const oldest = listCache.keys().next().value as string | undefined;
    if (!oldest) break;
    listCache.delete(oldest);
  }
}

function listCacheKey(body: Record<string, unknown>) {
  return JSON.stringify(body);
}

async function prefetchJobsPage(body: Record<string, unknown>, rankingRevision: number) {
  const key = `${rankingRevision}:${listCacheKey(body)}`;
  const cached = listCache.get(key);
  if (cached?.expiresAt && cached.expiresAt > Date.now()) return;
  const url = `${API_BASE.replace(/\/$/, "")}/jobs/list`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) return;
  const data = (await response.json()) as ListResponse;
  if (data?.success && Array.isArray(data.data)) {
    cacheListResponse(key, data);
  }
}

function statusTabToApi(statusTab: JobStatusTab): { applied?: boolean; status?: string } {
  if (statusTab === "posted") return { applied: false };
  if (statusTab === "bid-ready") return { applied: true, status: "BidReady" };
  if (statusTab === "bid-completed") return { applied: true, status: "BidCompleted" };
  if (statusTab === "applied") return { applied: true, status: "Applied" };
  if (statusTab === "scheduled") return { applied: true, status: "Scheduled" };
  if (statusTab === "declined") return { applied: true, status: "Declined" };
  return {};
}

function appendScoreFilters(body: Record<string, unknown>, scores: JobScoreFilters) {
  const keys: { key: keyof JobScoreFilters; api: string }[] = [
    { key: "overall", api: "Overall" },
    { key: "skill", api: "Skill" },
  ];
  for (const { key, api } of keys) {
    const r = scores[key];
    if (r.min !== 0) body[`score${api}Min`] = String(r.min);
    if (r.max !== 100) body[`score${api}Max`] = String(r.max);
  }
}

function workModeToRemote(workMode: string): string | undefined {
  if (workMode === "remote") return "Remote";
  if (workMode === "hybrid") return "Hybrid";
  if (workMode === "onsite") return "On-site";
  return undefined;
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

  return useMemo(
    () => ({
      ...filters,
      jobQuery: debouncedJobQuery,
      companyQuery: debouncedCompanyQuery,
    }),
    [filters, debouncedJobQuery, debouncedCompanyQuery],
  );
}

export function buildJobsListBody(
  filters: JobSearchFilterState,
  opts: { page: number; limit: number; applierName?: string; statusTab?: JobStatusTab },
): Record<string, unknown> {
  const statusTab = opts.statusTab ?? filters.statusTab;
  const body: Record<string, unknown> = {
    q: filters.jobQuery.trim(),
    sort: SORT_TO_API[filters.sort] || "postedAt_desc",
    page: opts.page,
    limit: opts.limit,
    jobSources: filters.source.length
      ? filters.source.join(",")
      : JobSourceTitles.join(","),
  };

  if (opts.applierName) body.applierName = opts.applierName;
  if (filters.aiExtractedOnly) body.aiExtracted = true;
  if (filters.includeExternalScraped) body.includeExternalScraped = true;

  if (filters.companyQuery.trim()) body["company.name"] = filters.companyQuery.trim();
  if (filters.location !== "all") body["details.position"] = filters.location;
  const remote = workModeToRemote(filters.workMode);
  if (remote) body["details.remote"] = remote;
  if (filters.seniority.length) body["details.seniority"] = filters.seniority.join(",");
  // All roles selected ≡ no role filter (still show unscanned jobs).
  if (
    filters.titleRoles.length > 0 &&
    filters.titleRoles.length < JOB_TITLE_SCAN_ROLES.length
  ) {
    body.titleScanned = filters.titleRoles.join(",");
  }
  if (filters.industry !== "all") body["company.tags"] = filters.industry;
  if (filters.postedFrom) body.postedAtFrom = filters.postedFrom;
  if (filters.postedTo) body.postedAtTo = filters.postedTo;

  Object.assign(body, statusTabToApi(statusTab));
  appendScoreFilters(body, filters.scores);
  return body;
}

/** Shared filter body for batched status counts (no sort/status tab). */
export function buildJobsCountsBody(
  filters: JobSearchFilterState,
  applierName?: string,
): Record<string, unknown> {
  const body = buildJobsListBody(filters, {
    page: 1,
    limit: 1,
    applierName,
    statusTab: "all",
  });
  delete body.sort;
  delete body.page;
  delete body.limit;
  delete body.applied;
  delete body.status;
  return body;
}

export function useJobsList(
  filters: JobSearchFilterState,
  excludeIds: Set<string> = new Set(),
  rankingRevision = 0,
) {
  const { post, request } = useApi(API_BASE);
  const { applier, applierReady } = useApplier();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [rawJobs, setRawJobs] = useState<Job[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [statusCounts, setStatusCounts] = useState(EMPTY_STATUS_COUNTS);
  const [recommendationFallback, setRecommendationFallback] = useState(false);
  const [recommendationReason, setRecommendationReason] = useState<string | null>(null);
  const [recommendationWarming, setRecommendationWarming] = useState(false);
  const [catalogTotal, setCatalogTotal] = useState<number | null>(null);
  const [rankingStatus, setRankingStatus] = useState<ListResponse["rankingStatus"]>(null);

  const hasLoadedOnce = useRef(false);

  const debouncedFilters = useDebouncedTextFilters(filters);

  const jobs = useMemo(
    () => rawJobs.filter((job) => !excludeIds.has(job.id)),
    [rawJobs, excludeIds],
  );

  useEffect(() => {
    setPage(1);
  }, [debouncedFilters, pageSize]);

  const listBody = useMemo(
    () =>
      buildJobsListBody(debouncedFilters, {
        page,
        limit: pageSize,
        applierName: applier?.name,
      }),
    [debouncedFilters, page, pageSize, applier?.name, rankingRevision],
  );

  const countsBody = useMemo(
    () => buildJobsCountsBody(debouncedFilters, applier?.name),
    [debouncedFilters, applier?.name],
  );

  useEffect(() => {
    if (!applierReady) return;
    let cancelled = false;
    const controller = new AbortController();
    const isInitial = !hasLoadedOnce.current;
    const cacheKey = `${rankingRevision}:${listCacheKey(listBody)}`;
    const cached = listCache.get(cacheKey);
    const hasFreshCache = Boolean(cached && cached.expiresAt > Date.now());
    const applyResponse = (res: ListResponse) => {
      if (!res?.success || !Array.isArray(res.data)) return false;
      setRawJobs(res.data.map((doc) => mapDocToJob(doc, applier)));
      const responseTotal = res.pagination?.total ?? res.data.length;
      setTotal(responseTotal);
      setStatusCounts((previous) => ({ ...previous, all: responseTotal }));
      setRecommendationFallback(Boolean(res.recommendationFallback));
      setRecommendationReason(res.recommendationReason ?? null);
      setRecommendationWarming(Boolean(res.recommendationWarming));
      setCatalogTotal(typeof res.catalogTotal === "number" ? res.catalogTotal : null);
      setRankingStatus(res.rankingStatus ?? null);
      if (res.statusCounts) {
        setStatusCounts({ ...EMPTY_STATUS_COUNTS, ...res.statusCounts });
      }
      hasLoadedOnce.current = true;
      return true;
    };
    if (hasFreshCache && cached) applyResponse(cached.response);
    if (isInitial && !hasFreshCache) setLoading(true);
    else setRefreshing(true);

    (async () => {
      try {
        const res = (await request("/jobs/list", {
          method: "POST",
          body: listBody,
          signal: controller.signal,
        })) as ListResponse;
        if (cancelled) return;
        if (applyResponse(res)) {
          cacheListResponse(cacheKey, res);
          const currentPage = Number(listBody.page) || 1;
          const totalPages = res.pagination?.totalPages ?? 1;
          for (const adjacent of [currentPage - 1, currentPage + 1]) {
            if (adjacent >= 1 && adjacent <= totalPages) {
              void prefetchJobsPage({ ...listBody, page: adjacent }, rankingRevision).catch(() => {});
            }
          }
        } else if (isInitial && !hasFreshCache) {
          setRawJobs([]);
          setTotal(0);
          setRecommendationFallback(false);
          setRecommendationReason(null);
          setCatalogTotal(null);
        }
      } catch (e) {
        if ((e as Error)?.name === "AbortError") return;
        console.error(e);
        toast.error("Failed to load jobs", {
          description: "Check that Athens-server is running and VITE_API_URL is set.",
        });
        if (isInitial) {
          setRawJobs([]);
          setTotal(0);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [listBody, rankingRevision, request, applier, applierReady]);

  useEffect(() => {
    if (!applierReady) return;
    let cancelled = false;
    (async () => {
      try {
        const res = (await post("/jobs/list/counts", countsBody)) as CountsResponse;
        if (cancelled || !res?.success || !res.counts) return;
        setStatusCounts({ ...EMPTY_STATUS_COUNTS, ...res.counts });
      } catch {
        /* counts are optional */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [countsBody, applierReady, post]);

  const setPageSizeAndReset = useCallback((size: number) => {
    setPageSize(size);
    setPage(1);
  }, []);

  const patchJob = useCallback(
    (updated: Job) => {
      listCache.clear();
      const statusTab = debouncedFilters.statusTab;
      setRawJobs((prev) => {
        // Drop jobs that no longer match the active status tab (e.g. Apply on New).
        if (statusTab !== "all" && updated.status !== statusTab) {
          const ids = new Set(
            [updated.id, updated.backendId].filter((id): id is string => Boolean(id)),
          );
          const next = prev.filter(
            (job) => !ids.has(job.id) && !ids.has(job.backendId || ""),
          );
          setTotal((t) => Math.max(0, t - (prev.length - next.length)));
          return next;
        }
        return prev.map((job) => (job.id === updated.id ? updated : job));
      });
    },
    [debouncedFilters.statusTab],
  );

  const removeJobsById = useCallback((ids: string[]) => {
    if (!ids.length) return;
    const idSet = new Set(ids);
    setRawJobs((prev) => {
      const next = prev.filter((job) => !idSet.has(job.id) && !idSet.has(job.backendId || ""));
      setTotal((t) => Math.max(0, t - (prev.length - next.length)));
      return next;
    });
  }, []);

  const refreshStatusCounts = useCallback(async () => {
    if (!applierReady) return;
    try {
      const res = (await post("/jobs/list/counts", countsBody)) as CountsResponse;
      if (res?.success && res.counts) {
        setStatusCounts({ ...EMPTY_STATUS_COUNTS, ...res.counts });
      }
    } catch {
      /* counts are optional */
    }
  }, [applierReady, countsBody, post]);

  const rescoreVisibleJobs = useCallback((context: ProfileMatchContext) => {
    setRawJobs((previous) => previous.map((job) => rescoreJobWithContext(job, context)));
  }, []);

  return {
    jobs,
    total,
    loading,
    refreshing,
    page,
    pageSize,
    setPage,
    setPageSize: setPageSizeAndReset,
    statusCounts,
    applierReady,
    recommendationFallback,
    recommendationReason,
    recommendationWarming,
    catalogTotal,
    rankingStatus,
    patchJob,
    removeJobsById,
    refreshStatusCounts,
    rescoreVisibleJobs,
  };
}

function recommendationFallbackMessage(reason: string | null): string {
  switch (reason) {
    case "no_profile_skills":
    case "no_analyzed_resumes":
      return "Add your skills via the My skills button in the toolbar before using Best match — scoring is based on that list.";
    case "ranking_backend_unavailable":
      return "Best match is temporarily unavailable. Showing the newest jobs instead.";
    case "ranking_partial_retrieval":
    case "ranking_tail_incomplete":
      return "Personalized ranking is unavailable for this deep filtered page. Showing the newest jobs instead.";
    default:
      return "Personalized ranking is unavailable. Add your skills via the My skills button to enable Best match.";
  }
}

export { recommendationFallbackMessage };
