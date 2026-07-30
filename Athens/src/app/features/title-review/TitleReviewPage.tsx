import { useCallback, useEffect, useMemo, useState } from "react";
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
  removeTitleReviewJobs,
  type TitleReviewJob,
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

type ReviewTab = "review_required" | "failed";

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

export function TitleReviewPage() {
  const { applier } = useApplier();
  const { session, loading: sessionLoading, refresh: refreshSession, start, stop } = useTitleReviewSession();
  const [tab, setTab] = useState<ReviewTab>("review_required");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [sort, setSort] = useState<"newest" | "oldest">("newest");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [jobs, setJobs] = useState<TitleReviewJob[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mutation, setMutation] = useState<"approve" | "remove" | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => setPage(1), [debouncedQuery, sort, tab]);

  const load = useCallback(async () => {
    if (!applier?.name) return;
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
      setJobs(response.data);
      setTotal(response.pagination.total);
      if (page > Math.max(1, response.pagination.totalPages)) setPage(Math.max(1, response.pagination.totalPages));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to load title reviews");
    } finally {
      setLoading(false);
    }
  }, [applier?.name, debouncedQuery, page, pageSize, sort, tab]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (session.processed || session.status === "completed" || session.status === "cancelled") void load();
  }, [load, session.processed, session.status]);

  const { selectedIds, selectedJobs, selectJob, selectAllOnPage, clearSelection } = useJobSelection(jobs);
  useEffect(() => clearSelection(), [clearSelection, page, pageSize, tab, debouncedQuery, sort]);

  const pageIds = useMemo(() => jobs.map((job) => job.id), [jobs]);
  const selectedOnPage = pageIds.filter((id) => selectedIds.has(id)).length;
  const allOnPageSelected = pageIds.length > 0 && selectedOnPage === pageIds.length;
  const progress = session.total
    ? Math.min(100, Math.round(((session.processed ?? 0) / session.total) * 100))
    : 0;

  const refreshAll = useCallback(async () => {
    await Promise.all([load(), refreshSession()]);
  }, [load, refreshSession]);

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
    const previous = jobs;
    setDeleteOpen(false);
    setMutation("remove");
    setJobs((current) => current.filter((job) => !selectedIds.has(job.id)));
    clearSelection();
    try {
      const result = await removeTitleReviewJobs(applier.name, ids);
      toast.success(`Removed ${result.deletedCount ?? ids.length} job${ids.length === 1 ? "" : "s"} permanently`);
      await refreshAll();
    } catch (nextError) {
      setJobs(previous);
      toast.error(nextError instanceof Error ? nextError.message : "Failed to remove jobs");
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
                AI-approved titles stay in Job Search. Review-required titles remain hidden until approved.
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
                <Button size="sm" className="gap-1.5" onClick={() => void start()} disabled={sessionLoading || session.pending === 0}>
                  {sessionLoading ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
                  {(session.failedCount ?? 0) > 0 && session.pending === session.failedCount ? "Retry failed" : "Start review"}
                </Button>
              )}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["Waiting", session.pending ?? 0],
              ["Approved this run", session.approved ?? 0],
              ["Needs review", session.reviewRequiredCount ?? 0],
              ["Failed", session.failedCount ?? 0],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
                <div className="text-xs text-muted-foreground">{label}</div>
                <div className="mt-0.5 text-lg font-bold tabular-nums">{Number(value).toLocaleString()}</div>
              </div>
            ))}
          </div>

          {session.running ? (
            <div className="mt-4" aria-live="polite">
              <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
                <span>Processing {session.concurrency ?? 10} concurrent batches of up to {session.batchSize ?? 10}</span>
                <span className="font-mono tabular-nums">{session.processed ?? 0}/{session.total ?? 0}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-secondary">
                <div className="h-full bg-primary transition-[width] duration-300" style={{ width: `${progress}%` }} />
              </div>
            </div>
          ) : session.error ? (
            <div className="mt-4 flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertTriangle className="size-4 shrink-0" /> {session.error}
            </div>
          ) : null}
        </section>

        <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <div className="flex flex-col gap-3 border-b border-border p-3 sm:flex-row sm:items-center">
            <div className="flex rounded-lg bg-muted p-1">
              <button
                type="button"
                onClick={() => setTab("review_required")}
                className={cn("rounded-md px-3 py-1.5 text-sm font-semibold", tab === "review_required" ? "bg-background shadow-sm" : "text-muted-foreground")}
              >
                Review Required <span className="ml-1 tabular-nums">{session.reviewRequiredCount ?? "—"}</span>
              </button>
              <button
                type="button"
                onClick={() => setTab("failed")}
                className={cn("rounded-md px-3 py-1.5 text-sm font-semibold", tab === "failed" ? "bg-background shadow-sm" : "text-muted-foreground")}
              >
                Failed <span className="ml-1 tabular-nums">{session.failedCount ?? "—"}</span>
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
            <AthensSelect
              value={sort}
              onChange={(value) => setSort(value as "newest" | "oldest")}
              options={[{ value: "newest", label: "Newest" }, { value: "oldest", label: "Oldest" }]}
              size="sm"
              className="w-full sm:w-32"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 border-b border-border/60 bg-muted/20 px-3 py-2.5">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox
                checked={allOnPageSelected ? true : selectedOnPage > 0 ? "indeterminate" : false}
                onCheckedChange={() => selectAllOnPage(pageIds, allOnPageSelected)}
                disabled={loading || jobs.length === 0}
              />
              <span>{selectedIds.size ? `${selectedIds.size} selected` : "Select page"}</span>
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
          </div>

          {loading ? (
            <div className="flex min-h-64 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 size-5 animate-spin" /> Loading title reviews…
            </div>
          ) : error ? (
            <div className="m-4 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
              {error}
            </div>
          ) : jobs.length === 0 ? (
            <div className="flex min-h-64 flex-col items-center justify-center px-4 text-center">
              <CheckCircle2 className="mb-3 size-9 text-emerald-500" />
              <p className="font-semibold">{tab === "review_required" ? "No titles require review" : "No failed title checks"}</p>
              <p className="mt-1 text-sm text-muted-foreground">{query ? "Try a different search." : "This queue is clear."}</p>
            </div>
          ) : (
            <div className="divide-y divide-border/60">
              {jobs.map((job) => {
                const selected = selectedIds.has(job.id);
                return (
                  <article
                    key={job.id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={selected}
                    onClick={(event) => {
                      if ((event.target as HTMLElement).closest("a,button")) return;
                      selectJob(job.id, event.shiftKey);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        selectJob(job.id, event.shiftKey);
                      }
                    }}
                    className={cn("grid cursor-pointer gap-3 p-4 transition-colors lg:grid-cols-[auto_minmax(14rem,1.2fr)_minmax(16rem,2fr)_auto] lg:items-center", selected ? "bg-primary/[0.05]" : "hover:bg-muted/30")}
                  >
                    <Checkbox checked={selected} className="pointer-events-none mt-1 lg:mt-0" aria-label={`Select ${job.title}`} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h2 className="truncate font-semibold text-foreground">{job.title}</h2>
                        {job.applyUrl ? (
                          <a href={job.applyUrl} target="_blank" rel="noreferrer" className="shrink-0 text-muted-foreground hover:text-primary" title="Open job">
                            <ExternalLink className="size-3.5" />
                          </a>
                        ) : null}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                        <span>{job.company}</span><span>·</span><span>{job.source}</span><span>·</span><span>{formatDate(job.postedAt)}</span>
                      </div>
                    </div>
                    <div className="min-w-0 rounded-lg bg-muted/40 px-3 py-2 text-sm">
                      {tab === "failed" ? (
                        <><span className="font-semibold text-destructive">{job.titleReview?.error?.code || "FAILED"}</span><span className="ml-2 text-muted-foreground">{job.titleReview?.error?.message || "Classification failed."}</span></>
                      ) : (
                        <span className="text-muted-foreground">{job.titleReview?.reason || "No reason returned."}</span>
                      )}
                    </div>
                    <div className="text-left lg:text-right">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">Confidence</div>
                      <div className="font-mono text-sm font-bold tabular-nums">{confidenceLabel(job.titleReview?.confidence)}</div>
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
            pageSizeOptions={[10, 25, 50, 100]}
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

