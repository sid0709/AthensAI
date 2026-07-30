import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Play,
  RefreshCw,
  Search,
  Square,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useApplier } from "@/context/applier-context";
import {
  approveTitleReviewJobs,
  fetchTitleReviewJobs,
  removeTitleReviewJobsWithProgress,
  type TitleReviewJob,
  type TitleReviewRemovalProgress,
} from "@/app/api/jobTitleReview";
import { PageShell } from "@/app/components/layout/PageShell";
import { PaginationBar } from "@/app/components/shared/PaginationBar";
import { AthensSelect } from "@/app/components/forms";
import { Button } from "@/app/components/ui/button";
import { Checkbox } from "@/app/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/app/components/ui/alert-dialog";
import { cn } from "@/app/lib/utils";
import { useJobSelection } from "../job-search/hooks/useJobSelection";
import { useTitleReviewSession } from "./useTitleReviewSession";

type ReviewTab = "unreviewed" | "review_required" | "failed";
type ReviewSort = "confidence_desc" | "newest" | "oldest";
type DeletionProgressState = TitleReviewRemovalProgress & {
  phase: "deleting" | "refreshing" | "complete" | "partial";
};

function defaultSortForTab(tab: ReviewTab): ReviewSort {
  return tab === "review_required" ? "confidence_desc" : "newest";
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

export function TitleReviewPage() {
  const { applier } = useApplier();
  const { session, loading: sessionLoading, refresh: refreshSession, start, stop } = useTitleReviewSession();
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
  const latestLoadIdRef = useRef(0);
  const refreshedCompletionRef = useRef<string | null>(null);
  const deletionProgressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => () => {
    if (deletionProgressTimerRef.current) clearTimeout(deletionProgressTimerRef.current);
  }, []);

  useEffect(() => setPage(1), [debouncedQuery, sort, tab]);

  const load = useCallback(async () => {
    if (!applier?.name) {
      setLoading(false);
      return;
    }
    const loadId = ++latestLoadIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const response = await fetchTitleReviewJobs({
        applierName: applier.name,
        tab,
        page,
        limit: pageSize,
        q: debouncedQuery,
        sort,
      });
      if (loadId !== latestLoadIdRef.current) return;
      setJobs(response.data);
      setTotal(response.pagination.total);
      if (page > Math.max(1, response.pagination.totalPages)) setPage(Math.max(1, response.pagination.totalPages));
    } catch (nextError) {
      if (loadId !== latestLoadIdRef.current) return;
      setError(nextError instanceof Error ? nextError.message : "Failed to load title reviews");
    } finally {
      if (loadId === latestLoadIdRef.current) setLoading(false);
    }
  }, [applier?.name, debouncedQuery, page, pageSize, sort, tab]);

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
    await Promise.all([load(), refreshSession()]);
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
      deleted: 0,
      failed: 0,
      activeBatches: 0,
      completedBatches: 0,
      batchCount: Math.ceil(ids.length / 100),
    });
    setJobs((current) => current.filter((job) => !removingIds.has(job.id)));
    setTotal((current) => Math.max(0, current - ids.length));
    clearSelection();
    try {
      const result = await removeTitleReviewJobsWithProgress(applier.name, ids, (next) => {
        setDeletionProgress({ ...next, phase: "deleting" });
      });
      setDeletionProgress((current) => current ? { ...current, phase: "refreshing" } : current);
      await refreshAll();
      const partial = result.failedIds.length > 0;
      setDeletionProgress((current) => current ? { ...current, phase: partial ? "partial" : "complete" } : current);
      if (partial) {
        toast.error(`Removed ${result.deletedCount} job${result.deletedCount === 1 ? "" : "s"}; ${result.failedIds.length} could not be removed`, {
          description: result.errors[0],
        });
      } else {
        toast.success(`Removed ${result.deletedCount} job${result.deletedCount === 1 ? "" : "s"} permanently`);
      }
      deletionProgressTimerRef.current = setTimeout(() => setDeletionProgress(null), partial ? 6_000 : 2_500);
    } catch (nextError) {
      setDeletionProgress((current) => current ? {
        ...current,
        phase: "partial",
        processed: current.total,
        failed: Math.max(current.failed, current.total - current.deleted),
        activeBatches: 0,
      } : current);
      toast.error(nextError instanceof Error ? nextError.message : "Failed to remove jobs");
      await refreshAll();
      deletionProgressTimerRef.current = setTimeout(() => setDeletionProgress(null), 6_000);
    } finally {
      setMutation(null);
    }
  };

  return (
    <PageShell>
      <div className="space-y-4">
        <section className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h1 className="text-xl font-bold text-foreground">Review titles</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                <ExtensionSafeText value="Unreviewed jobs stay hidden from Job Search. Only AI- or manually approved titles appear there." />
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void refreshAll()} disabled={loading}>
                <RefreshCw className={cn("size-4", loading && "animate-spin")} /> Refresh
              </Button>
              {session.running ? (
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void stop()} disabled={sessionLoading}>
                  <Square className="size-3.5" /> Stop
                </Button>
              ) : (
                <Button size="sm" className="gap-1.5" onClick={() => void startReview()} disabled={sessionLoading || session.pending === 0}>
                  {sessionLoading ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
                  <ExtensionSafeText value={(session.failedCount ?? 0) > 0 && session.pending === session.failedCount ? "Retry failed" : "Start review"} />
                  <span className="rounded-full bg-primary-foreground/20 px-1.5 py-0.5 text-[10px] font-bold tabular-nums">
                    <ExtensionSafeText value={(session.pending ?? 0).toLocaleString()} />
                  </span>
                </Button>
              )}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["Unreviewed", session.unreviewedCount ?? 0],
              ["Approved this run", session.approved ?? 0],
              ["Needs review", session.reviewRequiredCount ?? 0],
              ["Failed", session.failedCount ?? 0],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
                <div className="text-xs text-muted-foreground"><ExtensionSafeText value={String(label)} /></div>
                <div className="mt-0.5 text-lg font-bold tabular-nums"><ExtensionSafeText value={Number(value).toLocaleString()} /></div>
              </div>
            ))}
          </div>

          {session.running ? (
            <div className="mt-4" aria-live="polite">
              <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
                <ExtensionSafeText
                  value={session.phase === "preparing"
                    ? "Preparing the indexed review queue…"
                    : session.phase === "finalizing"
                      ? "Refreshing the completed review queue…"
                      : `Processing ${session.concurrency ?? 10} concurrent batches of up to ${session.batchSize ?? 10}`}
                />
                <ExtensionSafeText className="font-mono tabular-nums" value={`${session.processed ?? 0}/${session.total ?? 0}`} />
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-secondary">
                <div className="h-full bg-primary transition-[width] duration-300" style={{ width: `${progress}%` }} />
              </div>
            </div>
          ) : session.error ? (
            <div className="mt-4 flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertTriangle className="size-4 shrink-0" /> <ExtensionSafeText value={session.error} />
            </div>
          ) : null}
        </section>

        <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <div className="flex flex-col gap-3 border-b border-border p-3 sm:flex-row sm:items-center">
            <div className="flex max-w-full overflow-x-auto rounded-lg bg-muted p-1">
              <button
                type="button"
                onClick={() => changeTab("unreviewed")}
                className={cn("whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-semibold", tab === "unreviewed" ? "bg-background shadow-sm" : "text-muted-foreground")}
              >
                Unreviewed <ExtensionSafeText className="ml-1 tabular-nums" value={session.unreviewedCount ?? "—"} />
              </button>
              <button
                type="button"
                onClick={() => changeTab("review_required")}
                className={cn("whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-semibold", tab === "review_required" ? "bg-background shadow-sm" : "text-muted-foreground")}
              >
                Review Required <ExtensionSafeText className="ml-1 tabular-nums" value={session.reviewRequiredCount ?? "—"} />
              </button>
              <button
                type="button"
                onClick={() => changeTab("failed")}
                className={cn("whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-semibold", tab === "failed" ? "bg-background shadow-sm" : "text-muted-foreground")}
              >
                <ExtensionSafeText value="Failed" /> <ExtensionSafeText className="ml-1 tabular-nums" value={session.failedCount ?? "—"} />
              </button>
            </div>
            <div className="relative min-w-0 flex-1 sm:max-w-sm">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search titles…"
                className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10"
              />
            </div>
            {tab !== "unreviewed" ? (
              <AthensSelect
                value={sort}
                onChange={(value) => setSort(value as ReviewSort)}
                options={tab === "review_required"
                  ? [
                      { value: "confidence_desc", label: "Confidence: high to low" },
                      { value: "newest", label: "Newest" },
                      { value: "oldest", label: "Oldest" },
                    ]
                  : [{ value: "newest", label: "Newest" }, { value: "oldest", label: "Oldest" }]}
                size="sm"
                className="w-full sm:w-48"
              />
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2 border-b border-border/60 bg-muted/20 px-3 py-2.5">
            {tab === "unreviewed" ? (
              <span className="text-xs text-muted-foreground">These jobs remain hidden until title review finishes.</span>
            ) : (
              <>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox
                    checked={allOnPageSelected ? true : selectedOnPage > 0 ? "indeterminate" : false}
                    onCheckedChange={() => selectAllOnPage(pageIds, allOnPageSelected)}
                    disabled={loading || jobs.length === 0}
                  />
                  <ExtensionSafeText value={selectedIds.size ? `${selectedIds.size} selected` : "Select page"} />
                </label>
                <div className="ml-auto flex items-center gap-2">
                  {tab === "review_required" ? (
                    <Button size="sm" className="h-8 gap-1.5" onClick={() => void approveSelected()} disabled={!selectedIds.size || mutation !== null}>
                      {mutation === "approve" ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
                      Approve
                    </Button>
                  ) : null}
                  <Button variant="outline" size="sm" className="h-8 gap-1.5 text-destructive" onClick={() => setDeleteOpen(true)} disabled={!selectedIds.size || mutation !== null}>
                    {mutation === "remove" ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                    Remove
                  </Button>
                </div>
              </>
            )}
          </div>

          {deletionProgress ? (
            <div className="border-b border-border/60 bg-destructive/[0.035] px-3 py-3" role="status" aria-live="polite">
              <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                {deletionProgress.phase === "deleting" || deletionProgress.phase === "refreshing" ? (
                  <Loader2 className="size-4 shrink-0 animate-spin text-destructive" />
                ) : deletionProgress.phase === "complete" ? (
                  <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
                ) : (
                  <AlertTriangle className="size-4 shrink-0 text-amber-600" />
                )}
                <ExtensionSafeText
                  value={deletionProgress.phase === "deleting"
                    ? `Removing ${deletionProgress.processed.toLocaleString()} of ${deletionProgress.total.toLocaleString()} jobs…`
                    : deletionProgress.phase === "refreshing"
                      ? "Deletion finished. Refreshing review counts…"
                      : deletionProgress.phase === "complete"
                        ? `Removed ${deletionProgress.deleted.toLocaleString()} jobs permanently.`
                        : `Deletion finished with ${deletionProgress.failed.toLocaleString()} failed items.`}
                />
                <ExtensionSafeText className="ml-auto font-mono text-xs tabular-nums text-muted-foreground" value={`${deletionPercent}%`} />
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
                <div
                  className={cn(
                    "h-full transition-[width] duration-300",
                    deletionProgress.phase === "partial"
                      ? "bg-amber-500"
                      : deletionProgress.phase === "complete"
                        ? "bg-emerald-500"
                        : "bg-destructive",
                  )}
                  style={{ width: `${deletionPercent}%` }}
                />
              </div>
              <div className="mt-1.5 flex flex-wrap justify-between gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                <ExtensionSafeText value={`${deletionProgress.deleted.toLocaleString()} deleted${deletionProgress.failed ? ` · ${deletionProgress.failed.toLocaleString()} failed` : ""}`} />
                <ExtensionSafeText
                  value={deletionProgress.phase === "deleting"
                    ? `${deletionProgress.activeBatches} active · ${deletionProgress.completedBatches}/${deletionProgress.batchCount} batches complete`
                    : "The review list and counts are synchronized after cleanup."}
                />
              </div>
            </div>
          ) : null}

          {loading && jobs.length === 0 ? (
            <div className="flex min-h-64 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 size-5 animate-spin" /> Loading title reviews…
            </div>
          ) : error ? (
            <div className="m-4 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
              <ExtensionSafeText value={error} />
            </div>
          ) : jobs.length === 0 ? (
            <div className="flex min-h-64 flex-col items-center justify-center px-4 text-center">
              <CheckCircle2 className="mb-3 size-9 text-emerald-500" />
              <p className="font-semibold">
                <ExtensionSafeText value={tab === "unreviewed"
                  ? "All titles have been reviewed"
                  : tab === "review_required"
                    ? "No titles require review"
                    : "No failed title checks"}
                />
              </p>
              <p className="mt-1 text-sm text-muted-foreground"><ExtensionSafeText value={query ? "Try a different search." : "This queue is clear."} /></p>
            </div>
          ) : (
            <div className="divide-y divide-border/60">
              {jobs.map((job) => {
                const selected = selectedIds.has(job.id);
                const selectable = tab !== "unreviewed";
                const scanning = job.titleReview?.processingState === "scanning";
                return (
                  <article
                    key={job.id}
                    role={selectable ? "button" : undefined}
                    tabIndex={selectable ? 0 : undefined}
                    aria-pressed={selectable ? selected : undefined}
                    onClick={(event) => {
                      if (!selectable) return;
                      if ((event.target as HTMLElement).closest("a,button")) return;
                      selectJob(job.id, event.shiftKey);
                    }}
                    onKeyDown={(event) => {
                      if (!selectable) return;
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        selectJob(job.id, event.shiftKey);
                      }
                    }}
                    className={cn(
                      "grid gap-2 px-3 py-2.5 transition-colors lg:items-center",
                      selectable
                        ? "cursor-pointer lg:grid-cols-[auto_minmax(12rem,1.2fr)_minmax(15rem,2fr)_auto]"
                        : "lg:grid-cols-[minmax(12rem,1.2fr)_minmax(15rem,2fr)_auto]",
                      selected ? "bg-primary/[0.05]" : "hover:bg-muted/30",
                    )}
                  >
                    {selectable ? (
                      <Checkbox checked={selected} className="pointer-events-none mt-1 lg:mt-0" aria-label={`Select ${job.title}`} />
                    ) : null}
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <h2 className="truncate text-sm font-semibold leading-5 text-foreground"><ExtensionSafeText value={job.title} /></h2>
                        {job.applyUrl ? (
                          <a href={job.applyUrl} target="_blank" rel="noreferrer" className="shrink-0 text-muted-foreground hover:text-primary" title="Open job">
                            <ExternalLink className="size-3" />
                          </a>
                        ) : null}
                      </div>
                      <div className="mt-0.5 flex flex-wrap gap-x-1.5 text-[11px] leading-4 text-muted-foreground">
                        <ExtensionSafeText value={job.company} /><span>·</span><ExtensionSafeText value={job.source} /><span>·</span><ExtensionSafeText value={formatDate(job.postedAt)} />
                      </div>
                    </div>
                    <div className="min-w-0 rounded-md bg-muted/40 px-2.5 py-1.5 text-xs leading-4">
                      {tab === "failed" ? (
                        <><ExtensionSafeText className="font-semibold text-destructive" value={job.titleReview?.error?.code || "FAILED"} /><ExtensionSafeText className="ml-2 text-muted-foreground" value={job.titleReview?.error?.message || "Classification failed."} /></>
                      ) : tab === "unreviewed" ? (
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          {scanning ? <Loader2 className="size-3 animate-spin" /> : null}
                          <ExtensionSafeText value={scanning ? "AI review in progress" : "Waiting for AI review"} />
                        </span>
                      ) : (
                        <ExtensionSafeText className="text-muted-foreground" value={job.titleReview?.reason || "No reason returned."} />
                      )}
                    </div>
                    <div className="text-left lg:text-right">
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground"><ExtensionSafeText value={tab === "unreviewed" ? "Status" : "Confidence"} /></div>
                      <div className={cn("text-xs font-bold tabular-nums", tab !== "unreviewed" && "font-mono")}><ExtensionSafeText value={tab === "unreviewed" ? (scanning ? "Reviewing" : "Waiting") : confidenceLabel(job.titleReview?.confidence)} /></div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

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
            className="border-t border-border px-3"
          />
        </section>
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={(open) => mutation === null && setDeleteOpen(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {selectedIds.size} job{selectedIds.size === 1 ? "" : "s"} permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes the selected job documents and their search, ranking, score, and cached records. This action can’t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mutation !== null}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              disabled={mutation !== null}
              onClick={(event) => { event.preventDefault(); void removeSelected(); }}
            >
              Remove permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}
