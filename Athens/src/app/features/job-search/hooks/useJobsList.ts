import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { deleteDB, openDB } from "idb";
import { toast } from "sonner";
import { useApi } from "@/api/useApi";
import { useApplier } from "@/context/applier-context";
import { API_BASE } from "@/lib/api-base";
import { retryTransient } from "@/lib/transient-retry";
import { mapDocToJob, normalizeId } from "../../../lib/job-adapters";
import type { CompanyJobGroup, Job } from "../../../types";
import { keepOnlyCompanyJob, removeCompanyJobs } from "../lib/companyGroupState";
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
  "bid-completed": 0,
  applied: 0,
  scheduled: 0,
  declined: 0,
};

const JOB_LIST_REQUEST_TIMEOUT_MS = 30_000;
const JOB_LIST_ENDPOINT = "/jobs";

const LIST_CACHE_TTL_MS = 10 * 60_000;
const LIST_CACHE_STALE_MS = 24 * 60 * 60_000;
const LIST_CACHE_MAX_ENTRIES = 200;
const LIST_CACHE_DB = "athens-job-search";
const LIST_CACHE_STORE = "responses";
type ListCacheEntry = { response: ListResponse; expiresAt: number; staleAt: number };
const listCache = new Map<string, ListCacheEntry>();
const listRequests = new Map<string, Promise<ListResponse>>();
let listCacheDbPromise: ReturnType<typeof openDB> | null = null;

function requestJobsPage(
  cacheKey: string,
  queryPath: string,
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

function listCacheKey(queryPath: string) {
  return queryPath;
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
  opts: { page: number; pageSize: number; statusTab?: JobStatusTab; profileId?: string },
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
  return `${JOB_LIST_ENDPOINT}?${params.toString()}`;
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
  const [staleResults, setStaleResults] = useState(false);
  const [retryRevision, setRetryRevision] = useState(0);
  const [statusCounts, setStatusCounts] = useState(EMPTY_STATUS_COUNTS);
  const rawGroupsRef = useRef<CompanyJobGroup[]>([]);
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
      }),
    [debouncedFilters, page, pageSize, applier?._id],
  );

  const currentQueryKey = listCacheKey(listQueryPath);
  const loading =
    !applierReady ||
    isDebouncing ||
    requestInFlight ||
    settledKey !== currentQueryKey;

  const settledKeyRef = useRef<string | null>(null);
  settledKeyRef.current = settledKey;

  useEffect(() => {
    memberRequestTokensRef.current.clear();
    memberCursorsRef.current.clear();
    setMemberLoadingIds(new Set());
    setMemberErrors({});
  }, [currentQueryKey]);

  useEffect(() => {
    if (!applierReady || isDebouncing) return;
    let cancelled = false;
    const cacheKey = currentQueryKey;
    let cached = listCache.get(currentQueryKey);
    let hasFreshCache = Boolean(cached && cached.expiresAt > Date.now());
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
			setRawGroups(mapResponseGroups(res.data, applierRef.current));
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
    setStaleResults(false);
    if (!hasFreshCache) {
      setRawGroups([]);
      setTotal(0);
      setTotalJobs(0);
      setSettledKey(null);
    }

    (async () => {
      try {
        const idbPromise = (!cached || cached.staleAt <= Date.now())
          ? readPersistentListResponse(cacheKey)
          : Promise.resolve(null);

        if (cached && !cancelled) {
          applyResponse(cached.response);
          if (cached.staleAt > Date.now() && cached.expiresAt <= Date.now()) setStaleResults(true);
        }

        const idbEntry = await idbPromise;
        if (idbEntry && !cancelled) {
          cached = idbEntry;
          hasFreshCache = idbEntry.expiresAt > Date.now();
          if (hasFreshCache) applyResponse(idbEntry.response);
          else if (idbEntry.staleAt > Date.now()) {
            applyResponse(idbEntry.response);
            setStaleResults(true);
          }
        }

        const res = await requestJobsPage(cacheKey, listQueryPath, request);
        if (cancelled) return;
        if (!applyResponse(res)) {
          throw new Error("The jobs response was incomplete");
        }
        cacheListResponse(cacheKey, res);
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
        } else if (settledKeyRef.current === currentQueryKey && rawGroupsRef.current.length > 0) {
          showingFallback = true;
          setStaleResults(true);
          setError(timedOut
            ? "Job refresh took too long. Showing the previous results."
            : "Could not refresh jobs. Showing the previous results.");
        } else {
			setRawGroups([]);
          setTotal(0);
			setTotalJobs(0);
          setSettledKey(currentQueryKey);
          setError(timedOut
            ? "Job Search took too long to respond. Please try again."
            : "Could not load jobs. Check the server connection and try again.");
        }
        if (!showingFallback) {
          toast.error("Failed to load jobs", {
            description: timedOut
              ? "The request timed out. Please try again."
              : "Check that athens-backend is running and VITE_API_URL is set.",
          });
        }
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
    setStaleResults(false);
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
    staleResults,
    retry,
    requestKey: currentQueryKey,
    resultsSettled: settledKey === currentQueryKey,
    countsLoading: loading,
    page,
    pageSize,
    statusCounts,
    applierReady,
    patchJob,
    removeJobsById,
		removeOtherCompanyJobs,
		loadCompanyMembers,
		memberLoadingIds,
    memberErrors,
    refreshStatusCounts,
  };
}
