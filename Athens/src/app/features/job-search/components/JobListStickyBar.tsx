import React from "react";
import { LayoutGrid } from "lucide-react";
import { PaginationBar } from "../../../components/shared/PaginationBar";
import { cn } from "../../../lib/utils";
import { JobBulkActionsBar, JobPageSelectionControls } from "./JobBulkActionsBar";
import type { JobResumeBulkProgress } from "../hooks/useJobResumeGeneration";
import type { RecommendResumeBulkProgress } from "../hooks/useRecommendResumes";

type JobListStickyBarProps = {
  selectedOnPage: number;
  pageCount: number;
  totalSelected: number;
  allOnPageSelected: boolean;
  onToggleSelectAll: () => void;
  onExport: () => void;
  onRemove: () => void;
  onMarkBidReady?: () => void;
  bidReadyPending?: boolean;
  onMarkApplied?: () => void;
  markAppliedPending?: boolean;
  onMarkWorkerPool?: () => void;
  workerPoolPending?: boolean;
  onMoveToNew?: () => void;
  moveToNewPending?: boolean;
  onGenerateResumes?: () => void;
  onStopGenerateResumes?: () => void;
  onRemoveResumes?: () => void;
  onStopRemoveResumes?: () => void;
  onRecommendResumes?: () => void;
  applyAllCompanyRoles?: boolean;
  onApplyAllCompanyRolesChange?: (enabled: boolean) => void;
  resumeGenerating?: boolean;
  resumeStopping?: boolean;
  resumeRemoving?: boolean;
  resumeRemovalStopping?: boolean;
  recommendRunning?: boolean;
  hasSelectedResumes?: boolean;
  resumeProgress?: JobResumeBulkProgress;
  recommendProgress?: RecommendResumeBulkProgress;
  page: number;
  pageSize: number;
  total: number;
  itemCount?: number;
  totalJobs?: number | null;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  pageSizeOptions?: number[];
  showGrid: boolean;
  onToggleGrid: () => void;
  loading?: boolean;
  className?: string;
};

export function JobListStickyBar({
  selectedOnPage,
  pageCount,
  totalSelected,
  allOnPageSelected,
  onToggleSelectAll,
  onExport,
  onRemove,
  onMarkBidReady,
  bidReadyPending,
  onMarkApplied,
  markAppliedPending,
  onMarkWorkerPool,
  workerPoolPending,
  onMoveToNew,
  moveToNewPending,
  onGenerateResumes,
  onStopGenerateResumes,
  onRemoveResumes,
  onStopRemoveResumes,
  onRecommendResumes,
  applyAllCompanyRoles,
  onApplyAllCompanyRolesChange,
  resumeGenerating,
  resumeStopping,
  resumeRemoving,
  resumeRemovalStopping,
  recommendRunning,
  hasSelectedResumes,
  resumeProgress,
  recommendProgress,
  page,
  pageSize,
  total,
  itemCount,
  totalJobs,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50, 100, 250, 500],
  showGrid,
  onToggleGrid,
  loading = false,
  className,
}: JobListStickyBarProps) {
  return (
    <div className={cn("athens-toolbar sticky top-0 z-20 mb-3", className)}>
      <div className="athens-surface">
        <JobBulkActionsBar
          totalSelected={totalSelected}
          onExport={onExport}
          onRemove={onRemove}
          onMarkBidReady={onMarkBidReady}
          bidReadyPending={bidReadyPending}
          onMarkApplied={onMarkApplied}
          markAppliedPending={markAppliedPending}
          onMarkWorkerPool={onMarkWorkerPool}
          workerPoolPending={workerPoolPending}
          onMoveToNew={onMoveToNew}
          moveToNewPending={moveToNewPending}
          onGenerateResumes={onGenerateResumes}
          onStopGenerateResumes={onStopGenerateResumes}
          onRemoveResumes={onRemoveResumes}
          onStopRemoveResumes={onStopRemoveResumes}
          onRecommendResumes={onRecommendResumes}
          applyAllCompanyRoles={applyAllCompanyRoles}
          resumeGenerating={resumeGenerating}
          resumeStopping={resumeStopping}
          resumeRemoving={resumeRemoving}
          resumeRemovalStopping={resumeRemovalStopping}
          recommendRunning={recommendRunning}
          hasSelectedResumes={hasSelectedResumes}
          resumeProgress={resumeProgress}
          recommendProgress={recommendProgress}
          loading={loading}
          embedded
        />

        <div className="athens-pager-row">
          <JobPageSelectionControls
            selectedOnPage={selectedOnPage}
            pageCount={pageCount}
            allOnPageSelected={allOnPageSelected}
            onToggleSelectAll={onToggleSelectAll}
            applyAllCompanyRoles={applyAllCompanyRoles}
            onApplyAllCompanyRolesChange={onApplyAllCompanyRolesChange}
            loading={loading}
          />
          <PaginationBar
            page={page}
            pageSize={pageSize}
            total={total}
            itemCount={itemCount}
            onPageChange={onPageChange}
            onPageSizeChange={onPageSizeChange}
            pageSizeOptions={pageSizeOptions}
            detailed
            unitLabel="companies"
            secondaryTotal={totalJobs}
            secondaryLabel="matching jobs"
            loading={loading}
            className="py-1 px-0 flex-1 min-w-0"
            tone="lens"
          />
          <button
            type="button"
            onClick={onToggleGrid}
            className={cn("athens-icon-btn", showGrid && "is-active")}
            title="Toggle grid view"
            aria-pressed={showGrid}
            aria-label="Toggle grid view"
          >
            <LayoutGrid size={18} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
