import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useApplier } from "@/context/applier-context";
import { removeJobs } from "../../api/jobs";
import { PageShell } from "../../components/layout/PageShell";
import { PaginationBar } from "../../components/shared/PaginationBar";
import { TabTransition } from "../../components/overlays";
import { useJobSearchNavigationOptional } from "../../context/JobSearchNavigationContext";
import {
  DEFAULT_JOB_FILTERS,
  downloadJobsCsv,
  type JobSearchFilterState,
} from "../../hooks/useJobSearchFilters";
import { isBetaTier } from "../../lib/beta";
import { JobExportDialog } from "./components/JobExportDialog";
import { JobListSkeleton } from "./components/JobListSkeleton";
import { JobListErrorState } from "./components/JobListErrorState";
import { JobListStickyBar } from "./components/JobListStickyBar";
import { JobListView } from "./components/JobListView";
import { JobSearchFilterPanel } from "./components/JobSearchFilterPanel";
import { useJobSelection } from "./hooks/useJobSelection";
import { useJobApplicationActions } from "./hooks/useJobApplicationActions";
import { runWithConcurrency } from "./lib/run-with-concurrency";
import { useJobResumeGeneration } from "./hooks/useJobResumeGeneration";
import { useJobsList, recommendationFallbackMessage } from "./hooks/useJobsList";
import { isExternalJob } from "../../types/job";
import { useProfileMatchSkills } from "./hooks/useProfileMatchSkills";

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100, 250, 500];

export function JobSearchPage() {
  return <JobSearchPageContent />;
}

function JobSearchPageContent() {
  const jobNav = useJobSearchNavigationOptional();
  const { applier } = useApplier();
  const isBeta = isBetaTier(applier?.tier);
  const [filters, setFilters] = useState<JobSearchFilterState>(DEFAULT_JOB_FILTERS);
  const [showGrid, setShowGrid] = useState(false);
  const [showScoresOnCards, setShowScoresOnCards] = useState(false);
  const [bookmarkedIds, setBookmarkedIds] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem("athens-job-bookmarks") ?? "[]") as string[]);
    } catch {
      return new Set();
    }
  });

  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const [exportOpen, setExportOpen] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const { profileVersion, matchContext } = useProfileMatchSkills();

  const { jobs, total, loading, error, staleResults, retry, requestKey, countsLoading, page, pageSize, setPage, setPageSize, statusCounts, recommendationFallback, recommendationReason, recommendationWarming, patchJob, refreshStatusCounts, rescoreVisibleJobs } =
    useJobsList(filters, removedIds, profileVersion);
  const { selectedIds, selectedJobs, selectJob, selectAllOnPage, clearSelection } = useJobSelection(jobs);
  const {
    applyToJob,
    updateJobStatus,
    cancelJobStatus,
    markBidReady,
    markBidReadyBulk,
    clearBidReadyBulk,
    isPending,
  } = useJobApplicationActions(patchJob, refreshStatusCounts);
  const {
    resumeStates,
    generateForJob,
    generateBulk,
    cancelBulk,
    removeBulkResumes,
    bulkRunning,
    bulkRemoving,
    bulkProgress,
  } = useJobResumeGeneration(jobs);
  const [bidReadyBulkPending, setBidReadyBulkPending] = useState(false);
  const [moveToNewBulkPending, setMoveToNewBulkPending] = useState(false);

  useEffect(() => {
    const pending = jobNav?.pendingFilters;
    if (!pending) return;
    setFilters((prev) => ({ ...prev, ...pending }));
    jobNav.clearPendingFilters();
  }, [jobNav?.pendingFilters, jobNav]);

  useEffect(() => {
    clearSelection();
  }, [filters, page, pageSize, profileVersion, requestKey, clearSelection]);

  useEffect(() => {
    if (matchContext) rescoreVisibleJobs(matchContext);
  }, [matchContext, profileVersion, rescoreVisibleJobs]);

  // Role filter is beta-only — clear when switching to a non-beta profile.
  useEffect(() => {
    if (isBeta) return;
    setFilters((prev) => (prev.titleRoles.length ? { ...prev, titleRoles: [] } : prev));
  }, [isBeta]);

  const pageIds = useMemo(() => jobs.map((j) => j.id), [jobs]);
  const selectedOnPage = useMemo(
    () => pageIds.filter((id) => selectedIds.has(id)).length,
    [pageIds, selectedIds],
  );
  const allOnPageSelected = pageIds.length > 0 && selectedOnPage === pageIds.length;
  const hasSelectedResumes = useMemo(
    () => selectedJobs.some((job) => resumeStates[job.id]?.status === "done"),
    [selectedJobs, resumeStates],
  );

  const toggleSelectAllOnPage = () => {
    selectAllOnPage(pageIds, allOnPageSelected);
  };

  const handleApplyAll = async (jobs = selectedJobs) => {
    const marketJobs = jobs.filter((job) => !isExternalJob(job));
    if (!marketJobs.length) {
      toast.message("External scraped jobs open in a new tab only — nothing to mark as applied.");
      return;
    }
    await runWithConcurrency(marketJobs, (job) => applyToJob(job, { openUrl: false }));
  };

  const downloadSelected = () => {
    downloadJobsCsv(selectedJobs, `jobs-${new Date().toISOString().slice(0, 10)}.csv`);
  };

  const handleExportWithApply = async () => {
    setExportBusy(true);
    try {
      await handleApplyAll();
      downloadSelected();
      setExportOpen(false);
    } finally {
      setExportBusy(false);
    }
  };

  const handleExportOnly = () => {
    downloadSelected();
    setExportOpen(false);
  };

  const handleRemove = async () => {
    const ids = [...selectedIds];
    if (!ids.length) return;
    // Optimistically hide, then permanently delete from the DB.
    setRemovedIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return next;
    });
    clearSelection();
    try {
      const res = await removeJobs(ids);
      if (!res?.success) throw new Error(res?.error || "Remove failed");
      toast.success(`Removed ${res.deletedCount ?? ids.length} job${ids.length === 1 ? "" : "s"}`);
      void refreshStatusCounts();
    } catch (err) {
      // Revert the optimistic hide so nothing silently disappears.
      setRemovedIds((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
      toast.error(err instanceof Error ? err.message : "Failed to remove jobs");
    }
  };

  const toggleBookmark = (id: string) => {
    setBookmarkedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      localStorage.setItem("athens-job-bookmarks", JSON.stringify([...next]));
      return next;
    });
  };

  const matchScoreHint =
    filters.sort === "matchScore"
      ? recommendationFallback
        ? recommendationFallbackMessage(recommendationReason)
        : recommendationWarming
          ? "Match scores are being recalculated for your profile — ranking will sharpen shortly."
          : "Best match ranks the most relevant jobs first; remaining jobs follow sorted by date."
      : null;

  const matchScoreHintVariant =
    filters.sort === "matchScore" && recommendationFallback ? "warning" : "info";

  return (
    <PageShell>
      <JobSearchFilterPanel
        filters={filters}
        onChange={setFilters}
        statusCounts={statusCounts}
        countsLoading={countsLoading}
        showScoresOnCards={showScoresOnCards}
        onShowScoresOnCardsChange={setShowScoresOnCards}
        matchScoreHint={matchScoreHint}
        matchScoreHintVariant={matchScoreHintVariant}
      />

      <JobListStickyBar
        selectedOnPage={selectedOnPage}
        pageCount={jobs.length}
        totalSelected={selectedIds.size}
        allOnPageSelected={allOnPageSelected}
        onToggleSelectAll={toggleSelectAllOnPage}
        onExport={() => setExportOpen(true)}
        onRemove={handleRemove}
        onMarkBidReady={() => {
          void (async () => {
            setBidReadyBulkPending(true);
            try {
              await markBidReadyBulk(selectedJobs);
              clearSelection();
            } finally {
              setBidReadyBulkPending(false);
            }
          })();
        }}
        bidReadyPending={bidReadyBulkPending}
        onMoveToNew={() => {
          void (async () => {
            setMoveToNewBulkPending(true);
            try {
              await clearBidReadyBulk(selectedJobs);
              clearSelection();
            } finally {
              setMoveToNewBulkPending(false);
            }
          })();
        }}
        moveToNewPending={moveToNewBulkPending}
        onGenerateResumes={() => {
          void generateBulk(selectedJobs);
        }}
        onStopGenerateResumes={cancelBulk}
        onRemoveResumes={() => {
          void removeBulkResumes(selectedJobs);
        }}
        resumeGenerating={bulkRunning}
        resumeRemoving={bulkRemoving}
        hasSelectedResumes={hasSelectedResumes}
        resumeProgress={bulkProgress ?? undefined}
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        showGrid={showGrid}
        onToggleGrid={() => setShowGrid((g) => !g)}
        loading={loading}
      />

      <JobExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        count={selectedIds.size}
        onExportWithApply={() => void handleExportWithApply()}
        onExportOnly={handleExportOnly}
        busy={exportBusy}
      />

      {!loading && staleResults && error ? (
        <div role="status" className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
          {error}
          <button type="button" className="ml-2 font-semibold underline underline-offset-2" onClick={retry}>
            Retry
          </button>
        </div>
      ) : null}

      {loading ? (
        <JobListSkeleton
          count={Math.min(pageSize, 8)}
          layout={showGrid ? "grid" : "list"}
        />
      ) : error && !staleResults ? (
        <JobListErrorState message={error} onRetry={retry} />
      ) : (
        <TabTransition tabKey={showGrid ? "grid" : "list"}>
          <JobListView
            jobs={jobs}
            layout={showGrid ? "grid" : "list"}
            selectedIds={selectedIds}
            onSelectJob={selectJob}
            showScores={showScoresOnCards}
            bookmarkedIds={bookmarkedIds}
            onToggleBookmark={toggleBookmark}
            isJobPending={isPending}
            onApply={(job) => void applyToJob(job)}
            onMarkBidReady={(job) => void markBidReady(job)}
            onMarkScheduled={(job) => void updateJobStatus(job, "scheduled")}
            onMarkDeclined={(job) => void updateJobStatus(job, "declined")}
            onCancel={(job) => void cancelJobStatus(job)}
            onJobScoresUpdated={patchJob}
            resumeStates={resumeStates}
            onGenerateResume={(job) => {
              void generateForJob(job);
            }}
          />
        </TabTransition>
      )}

      <PaginationBar
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        detailed
        loading={loading}
        className="mt-2"
      />
    </PageShell>
  );
}
