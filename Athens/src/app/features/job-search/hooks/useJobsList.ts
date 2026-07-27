import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { openDB } from "idb";
import { toast } from "sonner";
import { useApi } from "@/api/useApi";
import { useApplier } from "@/context/applier-context";
import { API_BASE } from "@/lib/api-base";
import { retryTransient } from "@/lib/transient-retry";
import { JobSourceTitles } from '@/app/data/jobs/pub';
import { JOB_TITLE_SCAN_ROLES } from "@/app/data/jobTitleRoles";
import { mapDocToJob, SORT_TO_API } from "../../../lib/job-adapters";
import { rescoreJobWithContext, type ProfileMatchContext } from "../../../lib/skill-match";
import { subscribeJobRankingReady } from "../../../services/job-ranking-events";
import type { CompanyJobGroup, Job } from "../../../types";
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
  pagination?: { offset: number; limit: number; total: number; nextOffset?: number | null };
};

type CountsResponse = {
  success?: boolean;
  counts?: Partial<Record<JobStatusTab, number>>;
  warming?: boolean;
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

function cachedStatusTab(cacheKey?: string): JobStatusTab {
  if (!cacheKey) return "all";
  try {
    const body = JSON.parse(cacheKey.slice(cacheKey.indexOf("{"))) as { applied?: boolean; status?: string };
    if (body.applied === false) return "posted";
    if (body.applied !== true) return "all";
    const statusByApi: Record<string, JobStatusTab> = {
      Applied: "applied",
      Scheduled: "scheduled",
      Declined: "declined",
      BidReady: "bid-ready",
      BidCompleted: "bid-completed",
    };
    return statusByApi[body.status || ""] || "all";
  } catch {
    return "all";
  }
}

function patchResponseJobStatus(
  response: ListResponse,
  jobId: string,
  status: Job["status"],
  cacheKey?: string,
): boolean {
  let changed = false;
  const requestedStatus = cachedStatusTab(cacheKey);
  const remove = requestedStatus !== "all" && requestedStatus !== status;
  response.data = (response.data || []).flatMap((row) => {
    if (Array.isArray(row.jobs)) {
      const jobs = row.jobs.flatMap((job) => {
        if (String(job._id || "") !== jobId) return [job];
        changed = true;
        if (remove) return [];
        job.viewerStatus = status;
        return [job];
      });
      return jobs.length ? [{ ...row, jobs }] : [];
    }
    if (String(row._id || "") !== jobId) return [row];
    changed = true;
    if (remove) return [];
    row.viewerStatus = status;
    return [row];
  });
  if (changed && remove && response.pagination) {
    response.pagination.total = Math.max(0, response.pagination.total - 1);
    if (typeof response.pagination.totalJobs === "number") {
      response.pagination.totalJobs = Math.max(0, response.pagination.totalJobs - 1);
    }
    response.pagination.totalPages = Math.ceil(response.pagination.total / Math.max(1, response.pagination.limit));
  }
  return changed;
}

async function patchPersistentJobStatus(jobId: string, status: Job["status"]) {
  try {
    const db = await listCacheDb();
    if (!db) return;
    const keys = await db.getAllKeys(LIST_CACHE_STORE);
    for (const key of keys) {
      const entry = (await db.get(LIST_CACHE_STORE, key)) as ListCacheEntry | undefined;
      if (entry && patchResponseJobStatus(entry.response, jobId, status, String(key))) {
        await db.put(LIST_CACHE_STORE, entry, key);
      }
    }
  } catch {
    /* Cache patching must never affect the mutation itself. */
  }
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
  request: (path: string, options: { method: string; body: unknown }) => Promise<unknown>,
) {
  const key = `${rankingRevision}:${listCacheKey(body)}`;
  const cached = listCache.get(key);
  if (cached?.expiresAt && cached.expiresAt > Date.now()) return;
  const persisted = await readPersistentListResponse(key);
  if (persisted?.expiresAt && persisted.expiresAt > Date.now()) return;
  const data = (await request(JOB_LIST_ENDPOINT, { method: "POST", body })) as ListResponse;
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
    filtersKey: JSON.stringify(effectiveFilters),
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
  if (!JOB_LIST_V2_ENABLED) body.groupBy = "company";

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
      });
    } else {
      groups[index].jobs.push(job);
    }
  }
  return groups;
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
  const [rawGroups, setRawGroups] = useState<CompanyJobGroup[]>([]);
  const [total, setTotal] = useState(0);
	const [totalJobs, setTotalJobs] = useState(0);
	const [memberLoadingIds, setMemberLoadingIds] = useState<Set<string>>(new Set());
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
  const [groupedBeta, setGroupedBeta] = useState(false);
  const rawGroupsRef = useRef<CompanyJobGroup[]>([]);
  const rankingEventVersionRef = useRef<string | null>(null);
  rawGroupsRef.current = rawGroups;

  const {
    filters: debouncedFilters,
    filtersKey: debouncedFiltersKey,
    isDebouncing,
  } = useDebouncedTextFilters(filters);
  const pageFilterKeyRef = useRef(debouncedFiltersKey);
  const filterChanged = pageFilterKeyRef.current !== debouncedFiltersKey;
  const requestPage = filterChanged ? 1 : page;

  const groups = useMemo(
    () => rawGroups
			.map((group) => ({ ...group, jobs: group.jobs.filter((job) => !excludeIds.has(job.id)) }))
			.filter((group) => group.jobs.length > 0),
    [rawGroups, excludeIds],
  );
	const jobs = useMemo(() => groups.flatMap((group) => group.jobs), [groups]);

  useEffect(() => {
    pageFilterKeyRef.current = debouncedFiltersKey;
    setPage(1);
  }, [debouncedFiltersKey, pageSize]);

  const listBody = useMemo(
    () =>
      buildJobsListBody(debouncedFilters, {
        page: requestPage,
        limit: pageSize,
        applierName: applier?.name,
      }),
    [debouncedFilters, requestPage, pageSize, applier?.name, rankingRevision],
  );

  const countsBody = useMemo(
    () => buildJobsCountsBody(debouncedFilters, applier?.name),
    [debouncedFilters, applier?.name],
  );

  const currentQueryKey = `${rankingRevision}:${listCacheKey(listBody)}`;
  const countsKey = listCacheKey(countsBody);
  const loading =
    !applierReady ||
    isDebouncing ||
    ((requestInFlight || settledKey !== currentQueryKey) && rawGroups.length === 0);

  useEffect(() => {
    if (!applierReady || isDebouncing) return;
    let cancelled = false;
    let timedOut = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, JOB_LIST_REQUEST_TIMEOUT_MS);
    const cacheKey = currentQueryKey;
    let cached = listCache.get(currentQueryKey);
    let hasFreshCache = Boolean(cached && cached.expiresAt > Date.now());
    const applyResponse = (res: ListResponse) => {
      if (!res?.success || !Array.isArray(res.data)) return false;
			setRawGroups(mapResponseGroups(res.data, applier));
      const responseTotal = res.pagination?.total ?? res.data.length;
      setTotal(responseTotal);
			setTotalJobs(res.pagination?.totalJobs ?? responseTotal);
      const v2RankingStatus = res.ranking?.status ?? null;
      setRecommendationFallback(Boolean(res.recommendationFallback));
      setRecommendationReason(res.recommendationReason ?? null);
      setRecommendationWarming(Boolean(res.recommendationWarming) || v2RankingStatus === "warming");
      setCatalogTotal(typeof res.catalogTotal === "number" ? res.catalogTotal : null);
      setRankingStatus(v2RankingStatus ?? res.rankingStatus ?? null);
      setGroupedBeta(res.beta === true);
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

        let pending = listRequests.get(cacheKey);
        if (!pending) {
          pending = retryTransient(
            () => request(JOB_LIST_ENDPOINT, {
              method: "POST",
              body: listBody,
              signal: controller.signal,
            }) as Promise<ListResponse>,
            { signal: controller.signal, delaysMs: [300] },
          );
          listRequests.set(cacheKey, pending);
          void pending.finally(() => {
            if (listRequests.get(cacheKey) === pending) listRequests.delete(cacheKey);
          }).catch(() => undefined);
        }
        const res = await pending;
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
        if ((e as Error)?.name === "AbortError" && !timedOut) return;
        console.error(e);
        if (cached && cached.staleAt > Date.now() && applyResponse(cached.response)) {
          setStaleResults(true);
          setError(timedOut
            ? "Job refresh took too long. Showing cached results."
            : "Could not refresh jobs. Showing cached results.");
        } else if (rawGroupsRef.current.length === 0) {
			setRawGroups([]);
          setTotal(0);
			setTotalJobs(0);
          setRecommendationFallback(false);
          setRecommendationReason(null);
          setGroupedBeta(false);
          setCatalogTotal(null);
          setSettledKey(currentQueryKey);
          setError(timedOut
            ? "Job Search took too long to respond. Please try again."
            : "Could not load jobs. Check the server connection and try again.");
        }
        toast.error("Failed to load jobs", {
          description: timedOut
            ? "The request timed out. Please try again."
            : "Check that Athens-server is running and VITE_API_URL is set.",
        });
      } finally {
        clearTimeout(timeout);
        if (!cancelled) setRequestInFlight(false);
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [currentQueryKey, retryRevision, request, applier, applierReady, isDebouncing]);

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

  useEffect(() => subscribeJobRankingReady(applier?.name, (event) => {
    if (event.version && rankingEventVersionRef.current === event.version) return;
    rankingEventVersionRef.current = event.version || null;
    setRetryRevision((revision) => revision + 1);
  }), [applier?.name]);

  const setPageSizeAndReset = useCallback((size: number) => {
    setPageSize(size);
    setPage(1);
  }, []);

  const patchJob = useCallback(
    (updated: Job) => {
      const updatedId = updated.backendId || updated.id;
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
      for (const [key, entry] of listCache) patchResponseJobStatus(entry.response, updatedId, updated.status, key);
      void patchPersistentJobStatus(updatedId, updated.status);
      const statusTab = debouncedFilters.statusTab;
			setRawGroups((previous) => {
				let removedGroupCount = 0;
				let removedJobCount = 0;
				let needsDirectoryRefresh = false;
				const next = previous.flatMap((group) => {
					const index = group.jobs.findIndex(
						(job) => job.id === updated.id || job.backendId === updated.backendId,
					);
					if (index < 0) return [group];
					if (statusTab !== "all" && updated.status !== statusTab) {
						removedJobCount += 1;
						const remaining = group.jobs.filter((_, jobIndex) => jobIndex !== index);
						const matchingJobCount = Math.max(0, (group.matchingJobCount ?? group.jobs.length) - 1);
						if (!remaining.length && matchingJobCount === 0) {
							removedGroupCount += 1;
							return [];
						}
						if (!remaining.length) needsDirectoryRefresh = true;
						return [{ ...group, jobs: remaining, matchingJobCount }];
					}
					const jobs = [...group.jobs];
					jobs[index] = updated;
					return [{ ...group, jobs }];
				});
				const removedUnits = JOB_LIST_V2_ENABLED ? removedJobCount : removedGroupCount;
				if (removedUnits) setTotal((value) => Math.max(0, value - removedUnits));
				if (removedJobCount) setTotalJobs((value) => Math.max(0, value - removedJobCount));
				if (needsDirectoryRefresh) queueMicrotask(() => setRetryRevision((revision) => revision + 1));
				return next;
      });
    },
    [debouncedFilters.statusTab],
  );

  const removeJobsById = useCallback((ids: string[]) => {
    if (!ids.length) return;
    const idSet = new Set(ids);
		setRawGroups((previous) => {
			let removedGroups = 0;
			let removedJobs = 0;
			let needsDirectoryRefresh = false;
			const next = previous.flatMap((group) => {
				const jobs = group.jobs.filter((job) => !idSet.has(job.id) && !idSet.has(job.backendId || ""));
				const removed = group.jobs.length - jobs.length;
				removedJobs += removed;
				const matchingJobCount = Math.max(0, (group.matchingJobCount ?? group.jobs.length) - removed);
				if (!jobs.length && matchingJobCount === 0) {
					removedGroups += 1;
					return [];
				}
				if (!jobs.length) needsDirectoryRefresh = true;
				return [{ ...group, jobs, matchingJobCount }];
			});
			const removedUnits = JOB_LIST_V2_ENABLED ? removedJobs : removedGroups;
			if (removedUnits) setTotal((value) => Math.max(0, value - removedUnits));
			if (removedJobs) setTotalJobs((value) => Math.max(0, value - removedJobs));
			if (needsDirectoryRefresh) queueMicrotask(() => setRetryRevision((revision) => revision + 1));
			return next;
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

	const loadCompanyMembers = useCallback(async (companyId: string) => {
		const group = rawGroups.find((candidate) => candidate.companyId === companyId);
		if (!group || group.nextMemberOffset == null || memberLoadingIds.has(companyId)) return;
		setMemberLoadingIds((previous) => new Set(previous).add(companyId));
		try {
			const response = (await request("/jobs/list/company-members", {
				method: "POST",
				body: {
					...listBody,
					companyId,
					memberOffset: group.nextMemberOffset,
					memberLimit: 10,
				},
			})) as MembersResponse;
			if (!response?.success || !Array.isArray(response.data)) return;
			const loaded = response.data.map((doc) => mapDocToJob(doc, applier));
			setRawGroups((previous) => previous.map((candidate) => {
				if (candidate.companyId !== companyId) return candidate;
				const seen = new Set(candidate.jobs.map((job) => job.id));
				return {
					...candidate,
					jobs: [...candidate.jobs, ...loaded.filter((job) => !seen.has(job.id))],
					nextMemberOffset: response.pagination?.nextOffset ?? null,
				};
			}));
		} catch (error) {
			toast.error("Could not load more roles", {
				description: error instanceof Error ? error.message : "Please try again.",
			});
		} finally {
			setMemberLoadingIds((previous) => {
				const next = new Set(previous);
				next.delete(companyId);
				return next;
			});
		}
	}, [applier, listBody, memberLoadingIds, rawGroups, request]);

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
    countsLoading: loading || countsLoading,
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
		loadCompanyMembers,
		memberLoadingIds,
    groupedBeta,
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
