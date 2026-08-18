import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  ExternalLink,
  Inbox,
  Loader2,
  Play,
  RefreshCw,
  Search,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useApplier } from "@/context/applier-context";
import {
  approveTitleReviewJobs,
  cacheTitleReviewJobs,
  fetchTitleReviewBootstrap,
  fetchTitleReviewJobs,
  getCachedTitleReviewJobs,
  invalidateTitleReviewListCache,
  prefetchTitleReviewJobs,
	removeTitleReviewJobs,
  titleReviewListCacheKey,
  type TitleReviewJob,
  type TitleReviewListOptions,
  type TitleReviewRemovalProgress,
} from "@/app/api/jobTitleReview";
import { PageShell } from "@/app/components/layout/PageShell";
import { PaginationBar } from "@/app/components/shared/PaginationBar";
import { AthensSelect } from "@/app/components/forms";
import { Checkbox } from "@/app/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/app/components/ui/alert-dialog";
import { cn } from "@/app/lib/utils";
import { useJobSelection } from "../job-search/hooks/useJobSelection";
import { useTitleReviewSession } from "./useTitleReviewSession";
import { useBackgroundTasks } from "@/app/context/BackgroundTaskContext";

type ReviewTab = "unreviewed" | "review_required" | "failed";
type ReviewSort = "confidence_asc" | "confidence_desc" | "newest" | "oldest";
type DeletionProgressState = TitleReviewRemovalProgress & {
  phase: "deleting" | "refreshing" | "complete" | "partial";
};

function defaultSortForTab(tab: ReviewTab): ReviewSort {
  return tab === "review_required" ? "confidence_asc" : "newest";
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function confidenceLabel(value?: number) {
  return typeof value === "number" ? `${Math.round(value * 100)}%` : "—";
}

/**
 * Some browser extensions wrap matching text nodes (for example every "AI")
 * in their own elements. React can no longer safely remove those relocated text
 * nodes when live review data changes. Keep ownership of the host span in React
 * and write its text imperatively so extensions can only mutate inside it.
 */
function ExtensionSafeText({ value, className }: { value: string | number; className?: string }) {
  const elementRef = useRef<HTMLSpanElement>(null);
  const text = String(value);

  useLayoutEffect(() => {
    const element = elementRef.current;
    if (element && element.textContent !== text) element.textContent = text;
  }, [text]);

  return <span ref={elementRef} className={className} data-title-review-text translate="no" />;
}

function TitleReviewRow({
  job,
  tab,
  selected,
  onSelect,
}: {
  job: TitleReviewJob;
  tab: ReviewTab;
  selected: boolean;
  onSelect: (id: string, shiftKey: boolean) => void;
}) {
  const scanning = job.titleReview?.processingState === "scanning";
  return (
    <article
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("a,button")) return;
        onSelect(job.id, event.shiftKey);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(job.id, event.shiftKey);
        }
      }}
      className={cn("athens-queue-row athens-queue-row--review", selected && "is-selected")}
    >
      <Checkbox checked={selected} className="pointer-events-none mt-1 lg:mt-0" aria-label={`Select ${job.title}`} />
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <h2 className="athens-card-title truncate"><ExtensionSafeText value={job.title} /></h2>
          {job.applyUrl ? (
            <a href={job.applyUrl} target="_blank" rel="noreferrer" className="athens-link shrink-0" title="Open job">
              <ExternalLink className="size-3.5" aria-hidden="true" />
            </a>
          ) : null}
        </div>
        <div className="athens-card-meta mt-1">
          <ExtensionSafeText value={job.company} /><span aria-hidden="true">·</span><ExtensionSafeText value={job.source} /><span aria-hidden="true">·</span><ExtensionSafeText value={formatDate(job.postedAt)} />
        </div>
      </div>
      <div className="athens-callout min-w-0 px-3 py-2 text-xs leading-4 text-[var(--athens-text-secondary)]">
        {tab === "failed" ? (
          <><ExtensionSafeText className="font-semibold text-[var(--athens-danger)]" value={job.titleReview?.error?.code || "FAILED"} /><ExtensionSafeText className="ml-2" value={job.titleReview?.error?.message || "Classification failed."} /></>
        ) : tab === "unreviewed" ? (
          <span className="flex items-center gap-1.5">
            {scanning ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : null}
            <ExtensionSafeText value={scanning ? "AI review in progress" : "Waiting for AI review"} />
          </span>
        ) : (
          <ExtensionSafeText value={job.titleReview?.reason || "No reason returned."} />
        )}
      </div>
      <div className="text-left lg:text-right">
        <div className="athens-eyebrow"><ExtensionSafeText value={tab === "unreviewed" ? "Status" : "Confidence"} /></div>
        <div className="mt-0.5 text-xs font-semibold tabular-nums"><ExtensionSafeText value={tab === "unreviewed" ? (scanning ? "Reviewing" : "Waiting") : confidenceLabel(job.titleReview?.confidence)} /></div>
      </div>
    </article>
  );
}

function TitleReviewRows({
  jobs,
  tab,
  selectedIds,
  onSelect,
}: {
  jobs: TitleReviewJob[];
  tab: ReviewTab;
  selectedIds: Set<string>;
  onSelect: (id: string, shiftKey: boolean) => void;
}) {
  const virtualized = jobs.length > 100;
  const [listElement, setListElement] = useState<HTMLDivElement | null>(null);
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const listRef = useCallback((node: HTMLDivElement | null) => {
    setListElement(node);
    setScrollElement(node?.closest<HTMLElement>("[data-page-scroll-container]") ?? null);
  }, []);

  useLayoutEffect(() => {
    if (!listElement || !scrollElement) return;
    const update = () => setScrollMargin(
      listElement.getBoundingClientRect().top
      - scrollElement.getBoundingClientRect().top
      + scrollElement.scrollTop,
    );
    update();
    const observer = new ResizeObserver(update);
    observer.observe(scrollElement);
    return () => observer.disconnect();
  }, [jobs.length, listElement, scrollElement]);

  const virtualizer = useVirtualizer({
    count: virtualized ? jobs.length : 0,
    getScrollElement: () => scrollElement,
    getItemKey: (index) => jobs[index]?.id || index,
    estimateSize: () => 76,
    overscan: 10,
    scrollMargin,
  });

  if (!virtualized) {
    return (
      <div className="athens-queue">
        {jobs.map((job) => (
          <TitleReviewRow key={job.id} job={job} tab={tab} selected={selectedIds.has(job.id)} onSelect={onSelect} />
        ))}
      </div>
    );
  }

  return (
    <div ref={listRef} className="relative" style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((virtualRow) => {
        const job = jobs[virtualRow.index];
        return (
          <div
            key={job.id}
            data-index={virtualRow.index}
            ref={virtualizer.measureElement}
            className="absolute left-0 top-0 w-full"
            style={{ transform: `translateY(${virtualRow.start - scrollMargin}px)` }}
          >
            <TitleReviewRow job={job} tab={tab} selected={selectedIds.has(job.id)} onSelect={onSelect} />
          </div>
        );
      })}
    </div>
  );
}

const REVIEW_TABS: { id: ReviewTab; label: string; icon: typeof Inbox }[] = [
  { id: "unreviewed", label: "Unreviewed", icon: Inbox },
  { id: "review_required", label: "Review required", icon: ClipboardList },
  { id: "failed", label: "Failed", icon: AlertTriangle },
];

export function TitleReviewPage() {
  const { applier } = useApplier();
	const { tasks: backgroundTasks, adoptTask, waitForTask } = useBackgroundTasks();
  const {
    session,
    loading: sessionLoading,
    refresh: refreshSession,
    start,
    stop,
    hydrate: hydrateSession,
  } = useTitleReviewSession({ autoLoad: false });
  const [tab, setTab] = useState<ReviewTab>("unreviewed");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [sort, setSort] = useState<ReviewSort>("newest");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [jobs, setJobs] = useState<TitleReviewJob[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mutation, setMutation] = useState<"approve" | "remove" | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletionProgress, setDeletionProgress] = useState<DeletionProgressState | null>(null);
	const [deletionTaskId, setDeletionTaskId] = useState<string | null>(null);
  const latestLoadIdRef = useRef(0);
  const initialBootstrapRef = useRef(true);
  const activeLoadRef = useRef<{
    key: string;
    controller: AbortController;
    promise: Promise<void>;
  } | null>(null);
  const refreshedCompletionRef = useRef<string | null>(null);
  const deletionProgressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => () => {
    if (deletionProgressTimerRef.current) clearTimeout(deletionProgressTimerRef.current);
    activeLoadRef.current?.controller.abort();
  }, []);

  useEffect(() => setPage(1), [debouncedQuery, sort, tab]);

	useEffect(() => {
		if (!deletionTaskId) return;
		const task = backgroundTasks.find((candidate) => candidate.id === deletionTaskId);
		if (!task || !["queued", "running", "cancelling"].includes(task.status)) return;
		const progress = task.progress || {};
		setDeletionProgress((current) => {
			if (!current) return current;
			const total = Number(progress.total ?? current.total);
			const completed = Number(progress.completed ?? 0);
			const failed = Number(progress.failed ?? 0);
			const cancelled = Number(progress.cancelled ?? 0);
			const remaining = Number(progress.remaining ?? Math.max(0, total - completed - failed - cancelled));
			const processed = Math.max(completed + failed + cancelled, total - remaining);
			return {
				...current,
				total,
				processed,
				removed: processed,
				deleted: completed,
				failed,
				activeBatches: Number(progress.active ?? 0) > 0 ? 1 : 0,
				completedBatches: processed >= total ? 1 : 0,
				batchCount: 1,
			};
		});
	}, [backgroundTasks, deletionTaskId]);

  const load = useCallback(({ force = false }: { force?: boolean } = {}) => {
    if (!applier?.name) {
      setLoading(false);
      return Promise.resolve();
    }
    const options: TitleReviewListOptions = {
      applierName: applier.name,
      tab,
      page,
      limit: pageSize,
      q: debouncedQuery,
      sort,
    };
    const bootstrap = initialBootstrapRef.current;
    const key = `${bootstrap ? "bootstrap:" : "list:"}${titleReviewListCacheKey(options)}`;
    if (!force && activeLoadRef.current?.key === key) return activeLoadRef.current.promise;

    const cached = getCachedTitleReviewJobs(options);
    if (cached && !force) {
      setJobs(cached.data);
      setTotal(cached.pagination.total);
      setLoading(false);
    }

    activeLoadRef.current?.controller.abort();
    const controller = new AbortController();
    const loadId = ++latestLoadIdRef.current;
    setLoading(true);
    setError(null);
    const promise = (async () => {
      try {
        const response = bootstrap
          ? await fetchTitleReviewBootstrap(options, { signal: controller.signal })
          : await fetchTitleReviewJobs(options, { signal: controller.signal });
        if (loadId !== latestLoadIdRef.current) return;
        if (bootstrap) {
          initialBootstrapRef.current = false;
          hydrateSession(response.session);
        }
        cacheTitleReviewJobs(options, response);
        setJobs(response.data);
        setTotal(response.pagination.total);
        if (page > Math.max(1, response.pagination.totalPages)) {
          setPage(Math.max(1, response.pagination.totalPages));
        }

        // Prefetch only from a warmed snapshot; a cold Firestore fallback should
        // stay focused on the page the user explicitly requested.
        if (response.meta.cacheSource !== "firestore") {
          setTimeout(() => {
            if (response.pagination.page < response.pagination.totalPages) {
              void prefetchTitleReviewJobs({ ...options, page: response.pagination.page + 1 }).catch(() => undefined);
            }
            if (options.tab === "review_required" && options.page === 1 && !options.q) {
              void prefetchTitleReviewJobs({ ...options, page: 1, limit: 250 })
                .then(() => prefetchTitleReviewJobs({ ...options, page: 1, limit: 500 }))
                .catch(() => undefined);
            }
          }, 100);
        }
      } catch (nextError) {
        if (controller.signal.aborted || loadId !== latestLoadIdRef.current) return;
        setError(nextError instanceof Error ? nextError.message : "Failed to load title reviews");
      } finally {
        if (loadId === latestLoadIdRef.current) setLoading(false);
        if (activeLoadRef.current?.key === key) activeLoadRef.current = null;
      }
    })();
    activeLoadRef.current = { key, controller, promise };
    return promise;
  }, [applier?.name, debouncedQuery, hydrateSession, page, pageSize, sort, tab]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const finished = session.status === "completed" || session.status === "cancelled";
    if (!finished || !session.finishedAt || refreshedCompletionRef.current === session.finishedAt) return;
    refreshedCompletionRef.current = session.finishedAt;
    void load();
  }, [load, session.finishedAt, session.status]);

  const { selectedIds, selectedJobs, selectJob, selectAllOnPage, clearSelection } = useJobSelection(jobs);
  useEffect(() => clearSelection(), [clearSelection, page, pageSize, tab, debouncedQuery, sort]);

  const pageIds = useMemo(() => jobs.map((job) => job.id), [jobs]);
  const selectedOnPage = pageIds.filter((id) => selectedIds.has(id)).length;
  const allOnPageSelected = pageIds.length > 0 && selectedOnPage === pageIds.length;
  const progress = session.total
    ? Math.min(100, Math.round(((session.processed ?? 0) / session.total) * 100))
    : 0;
  const deletionPercent = deletionProgress?.total
    ? Math.min(100, Math.round((deletionProgress.processed / deletionProgress.total) * 100))
    : 0;

  const refreshAll = useCallback(async () => {
    await Promise.all([load({ force: true }), refreshSession()]);
  }, [load, refreshSession]);

  const changeTab = useCallback((nextTab: ReviewTab) => {
    setTab(nextTab);
    setSort(defaultSortForTab(nextTab));
  }, []);

  const startReview = useCallback(async () => {
    const result = await start();
    if (result?.started) changeTab("review_required");
  }, [changeTab, start]);

  const approveSelected = async () => {
    if (!applier?.name || selectedIds.size === 0) return;
    const ids = selectedJobs.map((job) => job.id);
    const previous = jobs;
    setMutation("approve");
    setJobs((current) => current.filter((job) => !selectedIds.has(job.id)));
    clearSelection();
    try {
      const result = await approveTitleReviewJobs(applier.name, ids);
      invalidateTitleReviewListCache();
      toast.success(`Approved ${result.approvedCount ?? ids.length} title${ids.length === 1 ? "" : "s"}`);
      await refreshAll();
    } catch (nextError) {
      setJobs(previous);
      toast.error(nextError instanceof Error ? nextError.message : "Failed to approve titles");
    } finally {
      setMutation(null);
    }
  };

  const removeSelected = async () => {
    if (!applier?.name || selectedIds.size === 0) return;
    const ids = selectedJobs.map((job) => job.id);
    const removingIds = new Set(ids);
    if (deletionProgressTimerRef.current) {
      clearTimeout(deletionProgressTimerRef.current);
      deletionProgressTimerRef.current = null;
    }
    setDeleteOpen(false);
    setMutation("remove");
    setDeletionProgress({
      phase: "deleting",
      total: ids.length,
      processed: 0,
      removed: 0,
      deleted: 0,
      alreadyAbsent: 0,
      failed: 0,
      activeBatches: 0,
      completedBatches: 0,
			batchCount: 1,
    });
    setJobs((current) => current.filter((job) => !removingIds.has(job.id)));
    setTotal((current) => Math.max(0, current - ids.length));
    clearSelection();
    try {
			const result = await removeTitleReviewJobs(applier.name, ids);
			const task = result.task;
			if (task) {
				adoptTask(task);
				setDeletionTaskId(task.id);
				const finished = await waitForTask(task.id);
				if (finished.status === "failed" || finished.status === "cancelled") {
					throw new Error(finished.error || (finished.status === "cancelled" ? "Deletion cancelled" : "Deletion failed"));
				}
				const deletedCount = Math.max(0, Number(finished.result?.deletedCount ?? 0));
				const removedCount = Number(finished.progress.total ?? ids.length);
				const alreadyAbsentCount = Math.max(0, removedCount - deletedCount);
				invalidateTitleReviewListCache();
				setDeletionProgress((current) => current ? { ...current, phase: "refreshing" } : current);
				await refreshAll();
				setDeletionProgress((current) => current ? {
					...current,
					phase: "complete",
					processed: removedCount,
					removed: removedCount,
					deleted: deletedCount,
					alreadyAbsent: alreadyAbsentCount,
					failed: 0,
					activeBatches: 0,
					completedBatches: 1,
				} : current);
				if (removedCount === 0) {
					toast.info("The selected titles were already absent from the review queue");
				} else if (alreadyAbsentCount > 0) {
					toast.success(`Removed ${removedCount} title${removedCount === 1 ? "" : "s"} from the review queue`, {
						description: `${deletedCount} job${deletedCount === 1 ? " was" : "s were"} permanently deleted; ${alreadyAbsentCount} had already been deleted.`,
					});
				} else {
					toast.success(`Removed ${deletedCount} job${deletedCount === 1 ? "" : "s"} permanently`);
				}
				deletionProgressTimerRef.current = setTimeout(() => setDeletionProgress(null), 2_500);
				return;
			}

			const deletedCount = Math.max(0, Number(result.deletedCount ?? 0));
			const removedCount = Math.max(deletedCount, Number(result.removedCount ?? ids.length));
			const alreadyAbsentCount = Math.max(0, Number(result.alreadyAbsentCount ?? removedCount - deletedCount));
			invalidateTitleReviewListCache();
			setDeletionProgress((current) => current ? { ...current, phase: "refreshing" } : current);
			await refreshAll();
			setDeletionProgress((current) => current ? {
				...current,
				phase: "complete",
				processed: removedCount,
				removed: removedCount,
				deleted: deletedCount,
				alreadyAbsent: alreadyAbsentCount,
				failed: 0,
				activeBatches: 0,
				completedBatches: 1,
			} : current);
			if (deletedCount === 0 && alreadyAbsentCount > 0) {
				toast.info("The selected titles were already absent from the review queue");
			} else if (alreadyAbsentCount > 0) {
				toast.success(`Removed ${removedCount} title${removedCount === 1 ? "" : "s"} from the review queue`, {
					description: `${deletedCount} job${deletedCount === 1 ? " was" : "s were"} permanently deleted; ${alreadyAbsentCount} had already been deleted.`,
				});
			} else {
				toast.success(`Removed ${deletedCount} job${deletedCount === 1 ? "" : "s"} permanently`);
			}
			deletionProgressTimerRef.current = setTimeout(() => setDeletionProgress(null), 2_500);
    } catch (nextError) {
      setDeletionProgress((current) => current ? {
        ...current,
        phase: "partial",
        processed: current.total,
        failed: Math.max(current.failed, current.total - current.removed),
        activeBatches: 0,
      } : current);
      toast.error(nextError instanceof Error ? nextError.message : "Failed to remove jobs");
      await refreshAll();
      deletionProgressTimerRef.current = setTimeout(() => setDeletionProgress(null), 6_000);
    } finally {
			setDeletionTaskId(null);
      setMutation(null);
    }
  };

  const tabCount = (id: ReviewTab) => {
    if (id === "unreviewed") return session.unreviewedCount;
    if (id === "review_required") return session.reviewRequiredCount;
    return session.failedCount;
  };
  const showBulk = selectedIds.size > 0 || mutation !== null;

  return (
    <PageShell className="athens-ui">
      <div className="athens-toolbar sticky top-0 z-20 mb-3">
        <div className="athens-surface">
          <div className="athens-tabs scroll-x-only" role="tablist" aria-label="Title review queue">
            {REVIEW_TABS.map((item) => {
              const active = tab === item.id;
              const Icon = item.icon;
              const count = tabCount(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-current={active ? "true" : undefined}
                  onClick={() => changeTab(item.id)}
                  className={cn("athens-tab", active && "is-active")}
                >
                  <span className="athens-tab-icon">
                    <Icon size={16} aria-hidden="true" />
                  </span>
                  {item.label}
                  <span className="athens-count">
                    {count == null ? "—" : Number(count).toLocaleString()}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="athens-toolbar-row">
            <div className="athens-field-group">
              <div className="athens-field">
                <Search className="athens-field__icon" aria-hidden="true" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search titles…"
                  aria-label="Search titles"
                  className="athens-field__input"
                />
                {query ? (
                  <button type="button" onClick={() => setQuery("")} className="athens-field__clear" aria-label="Clear search">
                    <X size={12} aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            </div>
            {tab !== "unreviewed" ? (
              <AthensSelect
                value={sort}
                onChange={(value) => setSort(value as ReviewSort)}
                options={tab === "review_required"
                  ? [
                      { value: "confidence_asc", label: "Confidence: low to high" },
                      { value: "confidence_desc", label: "Confidence: high to low" },
                      { value: "newest", label: "Newest" },
                      { value: "oldest", label: "Oldest" },
                    ]
                  : [{ value: "newest", label: "Newest" }, { value: "oldest", label: "Oldest" }]}
                size="sm"
                className="w-full sm:w-52"
                tone="lens"
              />
            ) : null}
            <div className="athens-toolbar-actions ml-auto">
              {(session.approved ?? 0) > 0 ? (
                <span className="athens-status">Approved this run {Number(session.approved).toLocaleString()}</span>
              ) : null}
              <button type="button" className="athens-btn" onClick={() => void refreshAll()} disabled={loading}>
                <RefreshCw size={16} aria-hidden="true" className={cn(loading && "animate-spin")} />
                Refresh
              </button>
              {session.running ? (
                <button type="button" className="athens-btn" onClick={() => void stop()} disabled={sessionLoading}>
                  <Square size={16} aria-hidden="true" />
                  Stop
                </button>
              ) : (
                <button
                  type="button"
                  className="athens-btn-primary"
                  onClick={() => void startReview()}
                  disabled={sessionLoading || session.pending === 0}
                >
                  {sessionLoading ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
                  <ExtensionSafeText value={(session.failedCount ?? 0) > 0 && session.pending === session.failedCount ? "Retry failed" : "Start review"} />
                  <span className="athens-badge">
                    <ExtensionSafeText value={(session.pending ?? 0).toLocaleString()} />
                  </span>
                </button>
              )}
            </div>
          </div>

          {session.running ? (
            <div className="athens-dock-row" aria-live="polite">
              <div className="athens-progress">
                <div className="athens-progress__meta">
                  <ExtensionSafeText
                    value={session.phase === "preparing"
                      ? "Preparing the indexed review queue…"
                      : session.phase === "finalizing"
                        ? "Refreshing the completed review queue…"
                        : `Processing ${session.concurrency ?? 10} concurrent batches of up to ${session.batchSize ?? 10}`}
                  />
                  <ExtensionSafeText value={`${session.processed ?? 0}/${session.total ?? 0}`} />
                </div>
                <div className="athens-progress__track">
                  <div className="athens-progress__bar" style={{ width: `${progress}%` }} />
                </div>
              </div>
            </div>
          ) : session.error ? (
            <div className="athens-dock-row">
              <div className="athens-callout is-danger flex w-full items-center gap-2 text-sm">
                <AlertTriangle size={16} className="shrink-0" aria-hidden="true" />
                <ExtensionSafeText value={session.error} />
              </div>
            </div>
          ) : null}

          {showBulk ? (
            <div className="athens-dock-row">
              <div className="athens-toolbar-actions ml-auto">
                {tab === "failed" ? null : (
                  <button
                    type="button"
                    className="athens-btn-primary"
                    onClick={() => void approveSelected()}
                    disabled={!selectedIds.size || mutation !== null}
                  >
                    {mutation === "approve" ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <CheckCircle2 size={16} aria-hidden="true" />}
                    Approve
                  </button>
                )}
                <button
                  type="button"
                  className="athens-btn-danger"
                  onClick={() => setDeleteOpen(true)}
                  disabled={!selectedIds.size || mutation !== null}
                >
                  {mutation === "remove" ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Trash2 size={16} aria-hidden="true" />}
                  Remove
                </button>
              </div>
            </div>
          ) : null}

          {deletionProgress ? (
            <div className="athens-dock-row" role="status" aria-live="polite">
              <div className={cn("athens-progress", deletionProgress.phase === "complete" ? "athens-progress--complete" : "athens-progress--danger")}>
                <div className="athens-progress__meta">
                  <span className="inline-flex items-center gap-2">
                    {deletionProgress.phase === "deleting" || deletionProgress.phase === "refreshing" ? (
                      <Loader2 size={16} className="shrink-0 animate-spin" aria-hidden="true" />
                    ) : deletionProgress.phase === "complete" ? (
                      <CheckCircle2 size={16} className="shrink-0" aria-hidden="true" />
                    ) : (
                      <AlertTriangle size={16} className="shrink-0" aria-hidden="true" />
                    )}
                    <ExtensionSafeText
                      value={deletionProgress.phase === "deleting"
                        ? `Removing ${deletionProgress.processed.toLocaleString()} of ${deletionProgress.total.toLocaleString()} jobs…`
                        : deletionProgress.phase === "refreshing"
                          ? "Deletion finished. Refreshing review counts…"
                          : deletionProgress.phase === "complete"
                            ? deletionProgress.alreadyAbsent > 0
                              ? `Removed ${deletionProgress.removed.toLocaleString()} titles from the review queue.`
                              : `Removed ${deletionProgress.deleted.toLocaleString()} jobs permanently.`
                            : `Deletion finished with ${deletionProgress.failed.toLocaleString()} failed items.`}
                    />
                  </span>
                  <ExtensionSafeText value={`${deletionPercent}%`} />
                </div>
                <div className="athens-progress__track">
                  <div className="athens-progress__bar" style={{ width: `${deletionPercent}%` }} />
                </div>
                <div className="athens-progress__meta">
                  <ExtensionSafeText value={`${deletionProgress.removed.toLocaleString()} removed · ${deletionProgress.deleted.toLocaleString()} permanently deleted${deletionProgress.alreadyAbsent ? ` · ${deletionProgress.alreadyAbsent.toLocaleString()} already absent` : ""}${deletionProgress.failed ? ` · ${deletionProgress.failed.toLocaleString()} failed` : ""}`} />
                  <ExtensionSafeText
                    value={deletionProgress.phase === "deleting"
                      ? `${deletionProgress.activeBatches} active · ${deletionProgress.completedBatches}/${deletionProgress.batchCount} batches complete`
                      : "The review list and counts are synchronized after cleanup."}
                  />
                </div>
              </div>
            </div>
          ) : null}

          {error && jobs.length > 0 ? (
            <div className="athens-dock-row">
              <div className="athens-callout is-danger flex w-full items-center gap-2 text-xs">
                <AlertTriangle size={14} className="shrink-0" aria-hidden="true" />
                <ExtensionSafeText value={`${error} Showing the last successful results.`} />
              </div>
            </div>
          ) : null}

          <div className="athens-pager-row">
            <div className="athens-pager-select">
              <label className={cn("athens-select-label", loading || jobs.length === 0 ? "cursor-wait" : "cursor-pointer")}>
                <Checkbox
                  checked={allOnPageSelected ? true : selectedOnPage > 0 ? "indeterminate" : false}
                  onCheckedChange={() => selectAllOnPage(pageIds, allOnPageSelected)}
                  disabled={loading || jobs.length === 0}
                  aria-label="Select all titles on this page"
                />
                <span>
                  Select page <strong>{loading ? "—/—" : `${selectedOnPage}/${jobs.length}`}</strong>
                </span>
              </label>
            </div>
            <PaginationBar
              page={page}
              pageSize={pageSize}
              total={total}
              itemCount={jobs.length}
              onPageChange={setPage}
              onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
              pageSizeOptions={[10, 25, 50, 100, 250, 500]}
              loading={loading}
              unitLabel="titles"
              detailed
              tone="lens"
              className="py-1 px-0 flex-1 min-w-0"
            />
          </div>
        </div>
      </div>

      {loading && jobs.length === 0 ? (
        <div className="athens-queue" aria-label="Loading title reviews">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="athens-queue-row athens-queue-row--review" aria-hidden>
              <div className="h-3 w-3 rounded bg-[var(--athens-surface-subtle)]" />
              <div className="h-3 rounded bg-[var(--athens-surface-subtle)]" />
              <div className="h-3 rounded bg-[var(--athens-surface-subtle)]" />
              <div className="h-3 w-16 rounded bg-[var(--athens-surface-subtle)]" />
            </div>
          ))}
        </div>
      ) : error && jobs.length === 0 ? (
        <div className="athens-callout is-danger text-sm">
          <ExtensionSafeText value={error} />
        </div>
      ) : jobs.length === 0 ? (
        <div className="athens-empty">
          <CheckCircle2 size={28} aria-hidden="true" />
          <p className="athens-empty__title">
            <ExtensionSafeText value={tab === "unreviewed"
              ? "All titles have been reviewed"
              : tab === "review_required"
                ? "No titles require review"
                : "No failed title checks"}
            />
          </p>
          <p className="athens-empty__copy">
            <ExtensionSafeText
              value={query
                ? "Try a different search."
                : tab === "unreviewed"
                  ? "Unreviewed jobs stay hidden from Job Search until they are approved."
                  : "This queue is clear."}
            />
          </p>
        </div>
      ) : (
        <TitleReviewRows jobs={jobs} tab={tab} selectedIds={selectedIds} onSelect={selectJob} />
      )}

      <AlertDialog open={deleteOpen} onOpenChange={(open) => mutation === null && setDeleteOpen(open)}>
        <AlertDialogContent className="athens-ui athens-dialog flex flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
          <AlertDialogHeader className="athens-dialog-header">
            <AlertDialogTitle className="athens-settings__title">Remove {selectedIds.size} job{selectedIds.size === 1 ? "" : "s"} permanently?</AlertDialogTitle>
            <AlertDialogDescription className="athens-settings__lede">
              This deletes the selected job documents and their search, ranking, score, and cached records. This action can’t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="athens-dialog-footer">
            <button type="button" className="athens-btn" disabled={mutation !== null} onClick={() => setDeleteOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="athens-btn-danger"
              disabled={mutation !== null}
              onClick={() => { void removeSelected(); }}
            >
              Remove permanently
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}
