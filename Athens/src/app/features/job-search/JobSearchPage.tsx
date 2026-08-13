import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useApplier } from "@/context/applier-context";
import { removeJobs, removeOtherCompanyJobs as removeCompanySiblingJobs } from "../../api/jobs";
import { useBackgroundTasks } from "../../context/BackgroundTaskContext";
import { PageShell } from "../../components/layout/PageShell";
import { PaginationBar } from "../../components/shared/PaginationBar";
import { TabTransition } from "../../components/overlays";
import { downloadJobsCsv } from "../../hooks/useJobSearchFilters";
import { JobExportDialog } from "./components/JobExportDialog";
import { RecommendResumeConflictDialog } from "./components/RecommendResumeConflictDialog";
import { JobListSkeleton } from "./components/JobListSkeleton";
import { JobListErrorState } from "./components/JobListErrorState";
import { JobListStickyBar } from "./components/JobListStickyBar";
import { JobListView } from "./components/JobListView";
import { JobSearchFilterPanel } from "./components/JobSearchFilterPanel";
import { useJobSelection } from "./hooks/useJobSelection";
import { useJobApplicationActions } from "./hooks/useJobApplicationActions";
import { runWithConcurrency } from "./lib/run-with-concurrency";
import { useJobResumeGeneration } from "./hooks/useJobResumeGeneration";
import {
  jobHasResumeRecommendation,
  useRecommendResumes,
} from "./hooks/useRecommendResumes";
import { canAssignLibraryResume } from "./lib/jobRecommendSnapshot";
import { useJobsList } from "./hooks/useJobsList";
import { isExternalJob, type CompanyJobGroup, type Job } from "../../types/job";
import { isBetaTier } from "../../lib/beta";
import { useJobSearchUrlState } from "./hooks/useJobSearchUrlState";
import { JOB_SEARCH_PAGE_SIZES } from "./lib/jobSearchUrlState";
import {
  companyApplyTargets,
  companyApplyTargetsForPrimaries,
  readApplyAllCompanyRoles,
  writeApplyAllCompanyRoles,
} from "./lib/companyApplyTargets";

const PAGE_SIZE_OPTIONS = [...JOB_SEARCH_PAGE_SIZES];

export function JobSearchPage() {
  return <JobSearchPageContent />;
}

function JobSearchPageContent() {
  const { applier } = useApplier();
  const isBeta = isBetaTier(applier?.tier);
  const profileId = applier?._id != null ? String(applier._id) : "";
  const { adoptTask, waitForTask } = useBackgroundTasks();
  const {
    state: urlState,
    setFilters,
    replaceFilters,
    setPage,
    clampPage,
    setPageSize,
    setView,
    setOpenJob,
    clearOpenJob,
  } = useJobSearchUrlState();
  const { filters, page, pageSize, groupId: expandedCompanyId, jobId: focusedJobId } = urlState;
  const showGrid = urlState.view === "grid";
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
  const [recommendConflictOpen, setRecommendConflictOpen] = useState(false);
  const [activeJobIds, setActiveJobIds] = useState<Record<string, string>>({});
  const { jobs, groups, total, totalJobs, loading, error, retry, requestKey, resultsSettled, countsLoading, statusCounts, patchJob, removeJobsById, removeOtherCompanyJobs, refreshStatusCounts, loadCompanyMembers, memberLoadingIds, memberErrors } =
    useJobsList(filters, removedIds, page, pageSize);

  useEffect(() => {
    setActiveJobIds((previous) => {
      const next: Record<string, string> = {};
      for (const group of groups) {
        const focused = group.companyId === expandedCompanyId
          ? group.jobs.find((job) => job.id === focusedJobId)?.id
          : undefined;
        next[group.companyId] = focused
          ?? group.jobs[0]?.id
          ?? "";
      }
      const previousKeys = Object.keys(previous);
      const unchanged = previousKeys.length === Object.keys(next).length
        && previousKeys.every((key) => previous[key] === next[key]);
      return unchanged ? previous : next;
    });
  }, [expandedCompanyId, focusedJobId, groups]);

  const visibleJobs = useMemo(
    () => groups.flatMap((group) => {
      const activeId = activeJobIds[group.companyId];
      const active = group.jobs.find((job) => job.id === activeId) ?? group.jobs[0];
      return active ? [active] : [];
    }),
    [activeJobIds, groups],
  );
  const { selectedIds, selectedJobs, selectJob, deselectJob, selectAllOnPage, clearSelection } = useJobSelection(visibleJobs);
  const {
    applyToJob,
    applyById,
    updateJobStatus,
    cancelJobStatus,
    markBidReady,
    markBidReadyBulk,
    markWorkerPool,
    markWorkerPoolBulk,
    moveToNewBulk,
    isPending,
  } = useJobApplicationActions(patchJob, refreshStatusCounts);
  const {
    resumeStates,
    generateForJob,
    generateBulk,
    cancelBulk,
    cancelRemoval,
    removeBulkResumes,
    bulkRunning,
    bulkStopping,
    bulkRemoving,
    removalStopping,
    bulkProgress,
  } = useJobResumeGeneration(jobs);
  const { recommendBulk, recommendRunning, recommendProgress } = useRecommendResumes(patchJob);
  const [bidReadyBulkPending, setBidReadyBulkPending] = useState(false);
  const [workerPoolBulkPending, setWorkerPoolBulkPending] = useState(false);
  const [moveToNewBulkPending, setMoveToNewBulkPending] = useState(false);
  const [applyAllCompanyRoles, setApplyAllCompanyRoles] = useState(readApplyAllCompanyRoles);

  useEffect(() => {
    if (isBeta || filters.statusTab !== "worker-pool") return;
    replaceFilters({ ...filters, statusTab: "all" });
  }, [filters, isBeta, replaceFilters]);

  useEffect(() => {
    clearSelection();
  }, [requestKey, clearSelection]);

  useEffect(() => {
    const visibleIds = new Set(visibleJobs.map((job) => job.id));
    for (const id of selectedIds) {
      if (!visibleIds.has(id)) deselectJob(id);
    }
  }, [deselectJob, selectedIds, visibleJobs]);

  useEffect(() => {
    if (!resultsSettled) return;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    if (page > totalPages) clampPage(totalPages);
  }, [clampPage, page, pageSize, resultsSettled, total]);

  useEffect(() => {
    if (!expandedCompanyId || !resultsSettled) return;
    const group = groups.find((candidate) => candidate.companyId === expandedCompanyId);
		if (!group || (group.matchingJobCount != null && group.matchingJobCount < 2)) {
      clearOpenJob();
      return;
    }
    const targetJobId = focusedJobId || group.jobs[0]?.id || "";
    if (!focusedJobId && targetJobId) {
      setOpenJob(expandedCompanyId, targetJobId);
      return;
    }
    if (
      targetJobId &&
      !group.jobs.some((job) => job.id === targetJobId) &&
      !memberLoadingIds.has(expandedCompanyId) &&
      !memberErrors[expandedCompanyId]
    ) {
      void loadCompanyMembers(expandedCompanyId, { focusJobId: targetJobId }).then((result) => {
        if (result?.focusValid === false && group.jobs[0]?.id) {
          setOpenJob(expandedCompanyId, group.jobs[0].id);
        }
      });
    } else if (
      group.jobs.length === 1 &&
      group.nextMemberOffset != null &&
      !memberLoadingIds.has(expandedCompanyId) &&
      !memberErrors[expandedCompanyId]
    ) {
      void loadCompanyMembers(expandedCompanyId, { focusJobId: targetJobId }).then((result) => {
        if (result?.focusValid === false && group.jobs[0]?.id) {
          setOpenJob(expandedCompanyId, group.jobs[0].id);
        }
      });
    }
  }, [
    clearOpenJob,
    expandedCompanyId,
    focusedJobId,
    groups,
    loadCompanyMembers,
    memberErrors,
    memberLoadingIds,
    resultsSettled,
    setOpenJob,
  ]);

  const pageIds = useMemo(() => visibleJobs.map((job) => job.id), [visibleJobs]);
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

  const handleActiveJobChange = (companyId: string, jobId: string) => {
    const previousId = activeJobIds[companyId];
    if (previousId === jobId) return;
    if (previousId && selectedIds.has(previousId)) deselectJob(previousId);
    setActiveJobIds((previous) => ({ ...previous, [companyId]: jobId }));
    setOpenJob(companyId, jobId);
  };

  const handleCompanyExpandedChange = (companyId: string, expanded: boolean) => {
    if (!expanded) {
      clearOpenJob();
      return;
    }
    const group = groups.find((candidate) => candidate.companyId === companyId);
    const activeJobId = activeJobIds[companyId] || group?.jobs[0]?.id || "";
    setOpenJob(companyId, activeJobId);
  };

  const markCompanySiblingsApplied = async (primaries: Job[]) => {
    if (!isBeta || !applyAllCompanyRoles || !primaries.length) return 0;
    const { siblings, unloadedIds } = companyApplyTargetsForPrimaries(primaries, groups);
    if (!siblings.length && !unloadedIds.length) return 0;
    const catalog = primaries[0].catalog || "market";
    const [siblingResults, unloadedResults] = await Promise.all([
      runWithConcurrency(siblings, (sibling) =>
        applyToJob(sibling, { openUrl: false, notify: false, refreshCounts: false }),
      ),
      runWithConcurrency(unloadedIds, (id) =>
        applyById(id, { catalog, notify: false, refreshCounts: false }),
      ),
    ]);
    void refreshStatusCounts();
    return [...siblingResults, ...unloadedResults].filter(Boolean).length;
  };

  const finishWorkerPoolSiblings = (primaries: Job[]) => {
    if (!isBeta || !applyAllCompanyRoles || !primaries.length) return;
    toast.message("Marking other company roles as applied…");
    void markCompanySiblingsApplied(primaries).then((applied) => {
      if (!applied) return;
      const companyLabel =
        primaries.length === 1
          ? primaries[0].company
          : `${new Set(primaries.map((job) => job.companyId)).size} companies`;
      toast.success(
        `Marked ${applied} other role${applied === 1 ? "" : "s"} at ${companyLabel} as applied`,
      );
    });
  };

  const handleApplyAll = async (jobs = selectedJobs) => {
    const marketJobs = jobs.filter((job) => !isExternalJob(job));
    if (!marketJobs.length) {
      toast.message("External scraped jobs open in a new tab only — nothing to mark as applied.");
      return;
    }
    await runWithConcurrency(marketJobs, (job) => applyToJob(job, { openUrl: false }));
  };

  const handleApply = async (job: Job) => {
    if (!isBeta || !applyAllCompanyRoles) {
      await applyToJob(job);
      return;
    }

    const group = groups.find((candidate) => candidate.companyId === job.companyId);
    const { siblings, unloadedIds } = companyApplyTargets(job, group);
    if (!siblings.length && !unloadedIds.length) {
      await applyToJob(job);
      return;
    }

    const catalog = job.catalog || "market";
    const [primaryOk, siblingResults, unloadedResults] = await Promise.all([
      applyToJob(job, { notify: false }),
      runWithConcurrency(siblings, (sibling) =>
        applyToJob(sibling, { openUrl: false, notify: false }),
      ),
      runWithConcurrency(unloadedIds, (id) =>
        applyById(id, { catalog, notify: false }),
      ),
    ]);
    const ok = [primaryOk, ...siblingResults, ...unloadedResults].filter(Boolean).length;
    const companyName = group?.company.name || job.company;
    if (ok) {
      toast.success(`Marked ${ok} job${ok === 1 ? "" : "s"} at ${companyName} as applied`);
    } else {
      toast.error("Failed to mark jobs as applied");
    }
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
    const ids = selectedJobs.map((job) => job.id);
    if (!ids.length) return;
    // Optimistically hide, then permanently delete from the DB.
    setRemovedIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return next;
    });
    clearSelection();
    try {
      const recordIds = selectedJobs.map((job) => job.backendId || job.id);
      const result = await removeJobs(recordIds);
      const deletedCount = Number(result.deletedCount ?? ids.length);
      removeJobsById(ids);
      toast.success(`Removed ${deletedCount} job${ids.length === 1 ? "" : "s"}`);
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

  const handleRemoveOtherCompanyJobs = async (group: CompanyJobGroup, activeJob: Job) => {
    try {
      const keepJobId = activeJob.backendId || activeJob.id;
      const res = await removeCompanySiblingJobs(group.companyId, keepJobId, profileId);
      if (!res?.success) throw new Error(res?.error || "Delete failed");
			let deletedCount = res.deletedCount;
			if (res.task) {
				adoptTask(res.task);
				const finished = await waitForTask(res.task.id);
				if (finished.status === "failed" || finished.status === "cancelled") {
					throw new Error(finished.error || (finished.status === "cancelled" ? "Delete cancelled" : "Delete failed"));
				}
				deletedCount = Number(finished.result?.deletedCount ?? 0);
			}
      removeOtherCompanyJobs(group.companyId, keepJobId);
			deletedCount = deletedCount
        ?? Math.max(0, (group.matchingJobCount ?? group.jobs.length) - 1);
      toast.success(
        `Deleted ${deletedCount} other role${deletedCount === 1 ? "" : "s"} at ${group.company.name}`,
      );
      void refreshStatusCounts();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete other roles");
      throw error;
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

  return (
    <PageShell>
      <JobSearchFilterPanel
        filters={filters}
        onChange={setFilters}
        statusCounts={statusCounts}
        countsLoading={countsLoading}
        showWorkerPoolTab={isBeta}
      />

      <JobListStickyBar
        selectedOnPage={selectedOnPage}
        pageCount={visibleJobs.length}
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
        onMarkWorkerPool={
          isBeta
            ? () => {
                void (async () => {
                  setWorkerPoolBulkPending(true);
                  try {
                    const primaries = selectedJobs.filter((job) => job.status === "posted");
                    const moved = await markWorkerPoolBulk(selectedJobs);
                    if (!moved) return;
                    clearSelection();
                    finishWorkerPoolSiblings(primaries);
                  } finally {
                    setWorkerPoolBulkPending(false);
                  }
                })();
              }
            : undefined
        }
        workerPoolPending={workerPoolBulkPending}
        onMoveToNew={() => {
          void (async () => {
            setMoveToNewBulkPending(true);
            try {
              await moveToNewBulk(selectedJobs);
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
        onStopRemoveResumes={cancelRemoval}
        onRemoveResumes={() => {
          void removeBulkResumes(selectedJobs);
        }}
        onRecommendResumes={
          filters.statusTab === "bid-ready" || filters.statusTab === "worker-pool"
            ? () => {
                const eligible = selectedJobs.filter((job) =>
                  canAssignLibraryResume(job.status),
                );
                const already = eligible.filter(jobHasResumeRecommendation).length;
                if (already > 0) {
                  setRecommendConflictOpen(true);
                  return;
                }
                void recommendBulk(eligible, { replaceExisting: true });
              }
            : undefined
        }
        applyAllCompanyRoles={applyAllCompanyRoles}
        onApplyAllCompanyRolesChange={isBeta ? (enabled) => {
          setApplyAllCompanyRoles(enabled);
          writeApplyAllCompanyRoles(enabled);
        } : undefined}
        resumeGenerating={bulkRunning}
        resumeStopping={bulkStopping}
        resumeRemoving={bulkRemoving}
        resumeRemovalStopping={removalStopping}
        recommendRunning={recommendRunning}
        hasSelectedResumes={hasSelectedResumes}
        resumeProgress={bulkProgress ?? undefined}
        recommendProgress={recommendProgress ?? undefined}
        page={page}
        pageSize={pageSize}
        total={total}
        itemCount={groups.length}
        totalJobs={totalJobs}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        showGrid={showGrid}
        onToggleGrid={() => setView(showGrid ? "list" : "grid")}
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

      <RecommendResumeConflictDialog
        open={recommendConflictOpen}
        onOpenChange={setRecommendConflictOpen}
        alreadyCount={selectedJobs.filter(
          (job) =>
            canAssignLibraryResume(job.status) && jobHasResumeRecommendation(job),
        ).length}
        totalCount={selectedJobs.filter((job) => canAssignLibraryResume(job.status)).length}
        busy={recommendRunning}
        onReplace={() => {
          setRecommendConflictOpen(false);
          void recommendBulk(
            selectedJobs.filter((job) => canAssignLibraryResume(job.status)),
            { replaceExisting: true },
          );
        }}
        onSkip={() => {
          setRecommendConflictOpen(false);
          void recommendBulk(
            selectedJobs.filter((job) => canAssignLibraryResume(job.status)),
            { replaceExisting: false },
          );
        }}
      />

      {loading ? (
        <JobListSkeleton
          count={Math.min(pageSize, 8)}
          layout={showGrid ? "grid" : "list"}
        />
      ) : error ? (
        <JobListErrorState message={error} onRetry={retry} />
      ) : (
        <TabTransition tabKey={showGrid ? "grid" : "list"}>
          <JobListView
            groups={groups}
            expandedCompanyId={expandedCompanyId}
            activeJobIds={activeJobIds}
            onExpandedChange={handleCompanyExpandedChange}
            onActiveJobChange={handleActiveJobChange}
            onLoadCompanyMembers={(companyId) => void loadCompanyMembers(companyId, { focusJobId: activeJobIds[companyId] })}
            onRemoveOtherCompanyJobs={handleRemoveOtherCompanyJobs}
            memberLoadingIds={memberLoadingIds}
            memberErrors={memberErrors}
            layout={showGrid ? "grid" : "list"}
            selectedIds={selectedIds}
            onSelectJob={selectJob}
            bookmarkedIds={bookmarkedIds}
            onToggleBookmark={toggleBookmark}
            isJobPending={isPending}
            onApply={(job) => void handleApply(job)}
            onMarkBidReady={(job) => void markBidReady(job)}
            onMarkWorkerPool={
              isBeta
                ? (job) => {
                    void (async () => {
                      const moved = await markWorkerPool(job);
                      if (!moved) return;
                      finishWorkerPoolSiblings([job]);
                    })();
                  }
                : undefined
            }
            onMarkScheduled={(job) => void updateJobStatus(job, "scheduled")}
            onMarkDeclined={(job) => void updateJobStatus(job, "declined")}
            onCancel={(job) => void cancelJobStatus(job)}
            resumeStates={resumeStates}
            onGenerateResume={(job) => {
              void generateForJob(job);
            }}
            onPatchJob={patchJob}
          />
        </TabTransition>
      )}

      <PaginationBar
        page={page}
        pageSize={pageSize}
        total={total}
        itemCount={groups.length}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        detailed
        unitLabel="companies"
        secondaryTotal={totalJobs}
        secondaryLabel="matching jobs"
        loading={loading}
        className="mt-2"
      />
    </PageShell>
  );
}
