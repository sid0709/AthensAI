import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { deleteDB, openDB } from "idb";
import { toast } from "sonner";
import { useApi } from "@/api/useApi";
import { useApplier } from "@/context/applier-context";
import { API_BASE } from "@/lib/api-base";
import { retryTransient } from "@/lib/transient-retry";
import { JobSourceTitles } from '@/app/data/jobs/pub';
import { mapDocToJob, SORT_TO_API } from "../../../lib/job-adapters";
import { rescoreJobWithContext, type ProfileMatchContext } from "../../../lib/skill-match";
import type { CompanyJobGroup, Job } from "../../../types";
import { keepOnlyCompanyJob, mergeCompanyMembers, removeCompanyJobs } from "../lib/companyGroupState";
import type {
  JobSearchFilterState,
  JobScoreFilters,
  JobStatusTab,
} from "../../../hooks/useJobSearchFilters";

type ListResponse = {
  success?: boolean;
  data?: Array<Record<string, unknown> & {
    companyId?: string;
    company?: { name?: string; logo?: string; url?: string };
    jobs?: Record<string, unknown>[];
    matchingJobCount?: number;
    nextMemberOffset?: number | null;
  }>;
  recommendationFallback?: boolean;
  recommendationReason?: string | null;
  recommendationWarming?: boolean;
  catalogTotal?: number | null;
  pagination?: { total: number; totalJobs?: number; unit?: "companies" | "jobs"; page: number; limit: number; totalPages: number };
  readModelVersion?: string | null;
  ranking?: { status?: "fresh" | "stale" | "warming"; version?: string | null; computedAt?: string | null };
  statusOverlayVersion?: string | null;
  rankingVersion?: string | null;
  rankingStatus?: "fresh" | "stale" | "warming" | "fallback" | "legacy" | null;
  beta?: boolean;
  catalogRevision?: string | null;
  personalizedThroughRank?: number | null;
  statusCounts?: Partial<Record<JobStatusTab, number>> | null;
};

type MembersResponse = {
  success?: boolean;
  data?: Record<string, unknown>[];
  focusJob?: Record<string, unknown> | null;
  focusValid?: boolean;
  focusOffset?: number | null;
  pagination?: { offset: number; limit: number; total: number; nextOffset?: number | null };
};

type CountsResponse = {
  success?: boolean;
  counts?: Partial<Record<JobStatusTab, number>>;
  warming?: boolean;
};

type ApiRequest = (
  path: string,
  options?: Omit<RequestInit, "body"> & { body?: unknown },
) => Promise<unknown>;

const EMPTY_STATUS_COUNTS: Record<JobStatusTab, number> = {
  all: 0,
  posted: 0,
  "bid-ready": 0,
  "bid-completed": 0,
  applied: 0,
  scheduled: 0,
  declined: 0,
};

const JOB_LIST_REQUEST_TIMEOUT_MS = 5_000;
const JOB_LIST_V2_ENABLED = !["0", "false", "no", "off"].includes(
  String(import.meta.env.VITE_JOB_LIST_V2_ENABLED ?? "true").trim().toLowerCase(),
);
const JOB_LIST_ENDPOINT = JOB_LIST_V2_ENABLED ? "/jobs/list/v2" : "/jobs/list";
const JOB_COUNTS_ENDPOINT = JOB_LIST_V2_ENABLED ? "/jobs/list/v2/counts" : "/jobs/list/counts";

const LIST_CACHE_TTL_MS = 10 * 60_000;
const LIST_CACHE_STALE_MS = 24 * 60 * 60_000;
const LIST_CACHE_MAX_ENTRIES = 200;
const LIST_CACHE_DB = "athens-job-search-v2";
const LIST_CACHE_STORE = "responses";
type ListCacheEntry = { response: ListResponse; expiresAt: number; staleAt: number };
const listCache = new Map<string, ListCacheEntry>();
const listRequests = new Map<string, Promise<ListResponse>>();
let listCacheDbPromise: ReturnType<typeof openDB> | null = null;

function requestJobsPage(
  cacheKey: string,
  body: Record<string, unknown>,
  request: ApiRequest,
): Promise<ListResponse> {
  const existing = listRequests.get(cacheKey);
  if (existing) return existing;

  // This request belongs to the cache key, not to any one React effect. A
  // rerender may stop consuming it, but must not abort it for another consumer.
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, JOB_LIST_REQUEST_TIMEOUT_MS);

  const pending = retryTransient(
    () => request(JOB_LIST_ENDPOINT, {
      method: "POST",
      body,
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
    if (listRequests.get(cacheKey) === pending) listRequests.delete(cacheKey);
  });

  listRequests.set(cacheKey, pending);
  return pending;
}

function listCacheDb() {
  if (typeof indexedDB === "undefined") return null;
  if (!listCacheDbPromise) {
    listCacheDbPromise = openDB(LIST_CACHE_DB, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(LIST_CACHE_STORE)) db.createObjectStore(LIST_CACHE_STORE);
      },
    });
  }
  return listCacheDbPromise;
}

/** Drop profile-sensitive job-list responses after the owning account is deleted. */
export async function clearJobListCacheStorage(): Promise<void> {
  listCache.clear();
  if (listCacheDbPromise) {
    const db = await listCacheDbPromise.catch(() => null);
    db?.close();
  }
  listCacheDbPromise = null;
  await deleteDB(LIST_CACHE_DB);
}

async function readPersistentListResponse(key: string): Promise<ListCacheEntry | null> {
  try {
    const db = await listCacheDb();
    if (!db) return null;
    const entry = (await db.get(LIST_CACHE_STORE, key)) as ListCacheEntry | undefined;
    if (!entry || entry.staleAt <= Date.now()) {
      if (entry) await db.delete(LIST_CACHE_STORE, key);
      return null;
    }
    listCache.set(key, entry);
    return entry;
  } catch {
    return null;
  }
}

async function persistListResponse(key: string, entry: ListCacheEntry) {
  try {
    const db = await listCacheDb();
    if (db) await db.put(LIST_CACHE_STORE, entry, key);
  } catch {
    /* IndexedDB is an optional acceleration layer. */
  }
}

async function clearPersistentListCache() {
  try {
    const db = await listCacheDb();
    if (db) await db.clear(LIST_CACHE_STORE);
  } catch {
    /* Cache invalidation must never affect the mutation itself. */
  }
}

function invalidateJobListCaches() {
  listCache.clear();
  void clearPersistentListCache();
}

function cacheListResponse(key: string, response: ListResponse) {
  const now = Date.now();
  for (const [existingKey, entry] of listCache) {
    if (entry.staleAt <= now) listCache.delete(existingKey);
  }
  listCache.delete(key);
  const entry = { response, expiresAt: now + LIST_CACHE_TTL_MS, staleAt: now + LIST_CACHE_STALE_MS };
  listCache.set(key, entry);
  void persistListResponse(key, entry);
  while (listCache.size > LIST_CACHE_MAX_ENTRIES) {
    const oldest = listCache.keys().next().value as string | undefined;
    if (!oldest) break;
    listCache.delete(oldest);
  }
}

function listCacheKey(body: Record<string, unknown>) {
  return JSON.stringify(body);
}

async function prefetchJobsPage(
  body: Record<string, unknown>,
  rankingRevision: number,
  request: ApiRequest,
) {
  const key = `${rankingRevision}:${listCacheKey(body)}`;
  const cached = listCache.get(key);
  if (cached?.expiresAt && cached.expiresAt > Date.now()) return;
  const persisted = await readPersistentListResponse(key);
  if (persisted?.expiresAt && persisted.expiresAt > Date.now()) return;
  const data = await requestJobsPage(key, body, request);
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
  body.groupBy = "company";

  if (opts.applierName) body.applierName = opts.applierName;
  if (filters.aiExtractedOnly) body.aiExtracted = true;
  if (filters.includeExternalScraped) body.includeExternalScraped = true;

  if (filters.companyQuery.trim()) body["company.name"] = filters.companyQuery.trim();
  if (filters.location !== "all") body["details.position"] = filters.location;
  const remote = workModeToRemote(filters.workMode);
  if (remote) body["details.remote"] = remote;
  if (filters.seniority.length) body["details.seniority"] = filters.seniority.join(",");
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
  delete body.groupBy;
  delete body.applied;
  delete body.status;
  return body;
}

function mapResponseGroups(
  rows: NonNullable<ListResponse["data"]>,
  applier: ReturnType<typeof useApplier>["applier"],
): CompanyJobGroup[] {
  const groups: CompanyJobGroup[] = [];
  const groupIndexes = new Map<string, number>();
  for (const row of rows) {
    if (Array.isArray(row.jobs)) {
      const jobs = row.jobs.map((doc) => mapDocToJob(doc, applier));
      const first = jobs[0];
      groups.push({
        companyId: String(row.companyId || first?.companyId || `legacy:${first?.id || "unknown"}`),
        company: {
          name: String(row.company?.name || first?.company || "Unknown"),
          logoUrl: String(row.company?.logo || first?.logoUrl || "") || undefined,
          url: String(row.company?.url || first?.companyUrl || "") || undefined,
        },
        jobs,
        matchingJobCount: typeof row.matchingJobCount === "number" ? row.matchingJobCount : undefined,
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
        memberOrder: { [job.id]: 0 },
      });
    } else {
      groups[index].jobs.push(job);
      groups[index].memberOrder = {
        ...groups[index].memberOrder,
        [job.id]: groups[index].jobs.length - 1,
      };
    }
  }
  return groups;
}

export function useJobsList(
  filters: JobSearchFilterState,
  excludeIds: Set<string> = new Set(),
  rankingRevision = 0,
  page = 1,
  pageSize = 25,
) {
  const { post, request } = useApi(API_BASE);
  const { applier, applierReady } = useApplier();

  const [rawGroups, setRawGroups] = useState<CompanyJobGroup[]>([]);
  const [total, setTotal] = useState(0);
	const [totalJobs, setTotalJobs] = useState(0);
	const [memberLoadingIds, setMemberLoadingIds] = useState<Set<string>>(new Set());
  const [memberErrors, setMemberErrors] = useState<Record<string, string>>({});
  const memberRequestTokensRef = useRef(new Map<string, symbol>());
  const [requestInFlight, setRequestInFlight] = useState(false);
  const [settledKey, setSettledKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [staleResults, setStaleResults] = useState(false);
  const [retryRevision, setRetryRevision] = useState(0);
  const [countsLoading, setCountsLoading] = useState(false);
  const [statusCounts, setStatusCounts] = useState(EMPTY_STATUS_COUNTS);
  const [recommendationFallback, setRecommendationFallback] = useState(false);
  const [recommendationReason, setRecommendationReason] = useState<string | null>(null);
  const [recommendationWarming, setRecommendationWarming] = useState(false);
  const [catalogTotal, setCatalogTotal] = useState<number | null>(null);
  const [rankingStatus, setRankingStatus] = useState<ListResponse["rankingStatus"]>(null);
  const rawGroupsRef = useRef<CompanyJobGroup[]>([]);
  const applierRef = useRef(applier);
  const rankingPollAttemptRef = useRef(0);
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

  const currentQueryKey = `${rankingRevision}:${listCacheKey(listBody)}`;
  const currentQueryKeyRef = useRef(currentQueryKey);
  currentQueryKeyRef.current = currentQueryKey;
  const countsKey = listCacheKey(countsBody);
  const loading =
    !applierReady ||
    isDebouncing ||
    ((requestInFlight || settledKey !== currentQueryKey) && rawGroups.length === 0);

  useEffect(() => {
    memberRequestTokensRef.current.clear();
    setMemberLoadingIds(new Set());
    setMemberErrors({});
  }, [currentQueryKey]);

  useEffect(() => {
    if (!applierReady || isDebouncing) return;
    let cancelled = false;
    const cacheKey = currentQueryKey;
    let cached = listCache.get(currentQueryKey);
    let hasFreshCache = Boolean(cached && cached.expiresAt > Date.now());
    const applyResponse = (res: ListResponse) => {
      if (!res?.success || !Array.isArray(res.data)) return false;
			setRawGroups(mapResponseGroups(res.data, applierRef.current));
      const responseTotal = res.pagination?.total ?? res.data.length;
      setTotal(responseTotal);
			setTotalJobs(res.pagination?.totalJobs ?? responseTotal);
      const v2RankingStatus = res.ranking?.status ?? null;
      setRecommendationFallback(Boolean(res.recommendationFallback));
      setRecommendationReason(res.recommendationReason ?? null);
      setRecommendationWarming(Boolean(res.recommendationWarming) || v2RankingStatus === "warming");
      setCatalogTotal(typeof res.catalogTotal === "number" ? res.catalogTotal : null);
      setRankingStatus(v2RankingStatus ?? res.rankingStatus ?? null);
      if (res.statusCounts) {
        setStatusCounts({ ...EMPTY_STATUS_COUNTS, ...res.statusCounts });
      }
      setSettledKey(currentQueryKey);
      return true;
    };
    setRequestInFlight(true);
    setError(null);
    setStaleResults(false);

    (async () => {
      try {
        if (!cached || cached.staleAt <= Date.now()) {
          cached = await readPersistentListResponse(cacheKey) ?? undefined;
          hasFreshCache = Boolean(cached && cached.expiresAt > Date.now());
        }
        if (cached && cached.staleAt > Date.now() && !cancelled) {
          applyResponse(cached.response);
          if (!hasFreshCache) setStaleResults(true);
        }

        const res = await requestJobsPage(cacheKey, listBody, request);
        if (cancelled) return;
        if (!applyResponse(res)) throw new Error("The jobs response was incomplete");
        cacheListResponse(cacheKey, res);
        const currentPage = Number(listBody.page) || 1;
        const totalPages = res.pagination?.totalPages ?? 1;
        for (const adjacent of [currentPage - 1, currentPage + 1]) {
          if (adjacent >= 1 && adjacent <= totalPages) {
            void prefetchJobsPage({ ...listBody, page: adjacent }, rankingRevision, request).catch(() => {});
          }
        }
      } catch (e) {
        const timedOut = (e as Error)?.name === "TimeoutError";
        if ((e as Error)?.name === "AbortError") return;
        console.error(e);
        let showingFallback = false;
        if (cached && cached.staleAt > Date.now() && applyResponse(cached.response)) {
          showingFallback = true;
          setStaleResults(true);
          setError(timedOut
            ? "Job refresh took too long. Showing cached results."
            : "Could not refresh jobs. Showing cached results.");
        } else if (rawGroupsRef.current.length > 0) {
          showingFallback = true;
          setStaleResults(true);
          setError(timedOut
            ? "Job refresh took too long. Showing the previous results."
            : "Could not refresh jobs. Showing the previous results.");
        } else if (rawGroupsRef.current.length === 0) {
			setRawGroups([]);
          setTotal(0);
			setTotalJobs(0);
          setRecommendationFallback(false);
          setRecommendationReason(null);
          setCatalogTotal(null);
          setSettledKey(currentQueryKey);
          setError(timedOut
            ? "Job Search took too long to respond. Please try again."
            : "Could not load jobs. Check the server connection and try again.");
        }
        if (!showingFallback) {
          toast.error("Failed to load jobs", {
            description: timedOut
              ? "The request timed out. Please try again."
              : "Check that Athens-server is running and VITE_API_URL is set.",
          });
        }
      } finally {
        if (!cancelled) setRequestInFlight(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentQueryKey, retryRevision, request, applierReady, isDebouncing]);

  useEffect(() => {
    if (!applierReady || isDebouncing) return;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const controller = new AbortController();
    const loadCounts = async (attempt = 0) => {
      if (!cancelled) setCountsLoading(true);
      try {
        const res = await retryTransient(
          () => request(JOB_COUNTS_ENDPOINT, {
            method: "POST",
            body: countsBody,
            signal: controller.signal,
          }) as Promise<CountsResponse>,
          { signal: controller.signal },
        );
        if (cancelled || !res?.success || !res.counts) return;
        setStatusCounts({ ...EMPTY_STATUS_COUNTS, ...res.counts });
        if (res.warming && attempt < 4) {
          retryTimer = setTimeout(() => void loadCounts(attempt + 1), 1_500);
        }
      } catch {
        /* counts are optional */
      } finally {
        if (!cancelled) setCountsLoading(false);
      }
    };
    void loadCounts();
    return () => {
      cancelled = true;
      controller.abort();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [countsKey, applierReady, request, isDebouncing]);

  useEffect(() => {
    const rankingPending = rankingStatus === "warming" || rankingStatus === "stale" || recommendationWarming;
    if (!JOB_LIST_V2_ENABLED || !applierReady || isDebouncing || !rankingPending) {
      rankingPollAttemptRef.current = 0;
      return undefined;
    }
    if (requestInFlight) return undefined;
    const delayMs = Math.min(5_000, 1_000 + rankingPollAttemptRef.current * 750);
    const timer = setTimeout(() => {
      rankingPollAttemptRef.current += 1;
      setRetryRevision((revision) => revision + 1);
    }, delayMs);
    return () => clearTimeout(timer);
  }, [applierReady, isDebouncing, rankingStatus, recommendationWarming, requestInFlight, retryRevision]);

  const patchJob = useCallback(
    (updated: Job) => {
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
      invalidateJobListCaches();
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
    invalidateJobListCaches();
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

  const removeOtherCompanyJobs = useCallback((companyId: string, keepJobId: string) => {
    invalidateJobListCaches();
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
    setCountsLoading(true);
    try {
      const res = (await post(JOB_COUNTS_ENDPOINT, countsBody)) as CountsResponse;
      if (res?.success && res.counts) {
        setStatusCounts({ ...EMPTY_STATUS_COUNTS, ...res.counts });
      }
    } catch {
      /* counts are optional */
    } finally {
      setCountsLoading(false);
    }
  }, [applierReady, countsBody, post]);

  const retry = useCallback(() => {
    setError(null);
    setStaleResults(false);
    setRequestInFlight(true);
    setRetryRevision((revision) => revision + 1);
  }, []);

  const rescoreVisibleJobs = useCallback((context: ProfileMatchContext) => {
		setRawGroups((previous) => {
			const rescored = previous.map((group) => ({
				...group,
				jobs: group.jobs.map((job) => rescoreJobWithContext(job, context)),
			}));
			if (debouncedFilters.sort !== "matchScore") return rescored;
			return rescored.map((group) => ({
				...group,
				jobs: [...group.jobs].sort((left, right) =>
					right.scores.overall - left.scores.overall ||
					right.postedAt.localeCompare(left.postedAt) ||
					left.id.localeCompare(right.id),
				),
			}));
    });
  }, [debouncedFilters.sort]);

	const loadCompanyMembers = useCallback(async (
    companyId: string,
    options: { focusJobId?: string } = {},
  ) => {
		const group = rawGroups.find((candidate) => candidate.companyId === companyId);
		if (!group || memberLoadingIds.has(companyId)) return;
    const focusLoaded = !options.focusJobId || group.jobs.some((job) => job.id === options.focusJobId);
    if (group.nextMemberOffset == null && focusLoaded) return;
    const queryKeyAtStart = currentQueryKey;
    const requestToken = Symbol(companyId);
    memberRequestTokensRef.current.set(companyId, requestToken);
		setMemberLoadingIds((previous) => new Set(previous).add(companyId));
		setMemberErrors((previous) => {
      if (!previous[companyId]) return previous;
      const next = { ...previous };
      delete next[companyId];
      return next;
    });
		try {
			const response = (await request(
        JOB_LIST_V2_ENABLED ? "/jobs/list/v2/company-members" : "/jobs/list/company-members",
        {
				method: "POST",
				body: {
					...listBody,
					companyId,
					...(JOB_LIST_V2_ENABLED
            ? { offset: group.nextMemberOffset ?? 1, limit: 10 }
            : { memberOffset: group.nextMemberOffset ?? 1, memberLimit: 10 }),
					...(options.focusJobId ? { focusJobId: options.focusJobId } : {}),
				},
			})) as MembersResponse;
			if (
        currentQueryKeyRef.current !== queryKeyAtStart ||
        memberRequestTokensRef.current.get(companyId) !== requestToken
      ) return undefined;
			if (!response?.success || !Array.isArray(response.data)) {
        throw new Error("The server could not load this company's roles.");
      }
			const memberOffset = response.pagination?.offset ?? group.nextMemberOffset ?? 1;
			const loaded = [
        ...response.data.map((doc, index) => ({
          job: mapDocToJob(doc, applier),
          order: memberOffset + index,
        })),
        ...(response.focusJob ? [{
          job: mapDocToJob(response.focusJob, applier),
          order: response.focusOffset ?? Number.MAX_SAFE_INTEGER,
        }] : []),
      ];
			setRawGroups((previous) => mergeCompanyMembers(
        previous,
        companyId,
        loaded,
        response.pagination?.nextOffset ?? null,
      ));
			setMemberErrors((previous) => {
        if (!previous[companyId]) return previous;
        const next = { ...previous };
        delete next[companyId];
        return next;
      });
      return { focusValid: response.focusValid !== false };
		} catch (error) {
			if (
        currentQueryKeyRef.current !== queryKeyAtStart ||
        memberRequestTokensRef.current.get(companyId) !== requestToken
      ) return undefined;
			setMemberErrors((previous) => ({
        ...previous,
        [companyId]: error instanceof Error ? error.message : "Please try again.",
      }));
			toast.error("Could not load more roles", {
				description: error instanceof Error ? error.message : "Please try again.",
			});
			return undefined;
		} finally {
			if (memberRequestTokensRef.current.get(companyId) === requestToken) {
        memberRequestTokensRef.current.delete(companyId);
        setMemberLoadingIds((previous) => {
          const next = new Set(previous);
          next.delete(companyId);
          return next;
        });
      }
		}
	}, [applier, currentQueryKey, listBody, memberLoadingIds, rawGroups, request]);

  return {
    jobs,
		groups,
    total,
		totalJobs,
    loading,
    error,
    staleResults,
    retry,
    requestKey: currentQueryKey,
    resultsSettled: settledKey === currentQueryKey,
    countsLoading: loading || countsLoading,
    page,
    pageSize,
    statusCounts,
    applierReady,
    recommendationFallback,
    recommendationReason,
    recommendationWarming,
    catalogTotal,
    rankingStatus,
    patchJob,
    removeJobsById,
		removeOtherCompanyJobs,
		loadCompanyMembers,
		memberLoadingIds,
    memberErrors,
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
    case "ranking_warming":
      return "Best match is preparing your skill ranking. Showing recent jobs briefly while it finishes.";
    case "ranking_partial_retrieval":
    case "ranking_tail_incomplete":
      return "Personalized ranking is unavailable for this deep filtered page. Showing the newest jobs instead.";
    default:
      return "Personalized ranking is unavailable. Add your skills via the My skills button to enable Best match.";
  }
}

export { recommendationFallbackMessage };
