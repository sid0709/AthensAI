import React from "react";
import { LayoutGrid } from "lucide-react";
import { PaginationBar } from "../../../components/shared/PaginationBar";
import { cn } from "../../../lib/utils";
import { JobBulkActionsBar } from "./JobBulkActionsBar";
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
  onMoveToNew?: () => void;
  moveToNewPending?: boolean;
  onGenerateResumes?: () => void;
  onStopGenerateResumes?: () => void;
  onRemoveResumes?: () => void;
  onStopRemoveResumes?: () => void;
  onRecommendResumes?: () => void;
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
  onMoveToNew,
  moveToNewPending,
  onGenerateResumes,
  onStopGenerateResumes,
  onRemoveResumes,
  onStopRemoveResumes,
  onRecommendResumes,
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
    <div className={cn("sticky top-0 z-20 -mx-1 px-1 mb-3", className)}>
      <div className="rounded-xl border border-border bg-card/95 backdrop-blur-xl shadow-sm overflow-x-clip">
        <JobBulkActionsBar
          selectedOnPage={selectedOnPage}
          pageCount={pageCount}
          totalSelected={totalSelected}
          allOnPageSelected={allOnPageSelected}
          onToggleSelectAll={onToggleSelectAll}
          onExport={onExport}
          onRemove={onRemove}
          onMarkBidReady={onMarkBidReady}
          bidReadyPending={bidReadyPending}
          onMoveToNew={onMoveToNew}
          moveToNewPending={moveToNewPending}
          onGenerateResumes={onGenerateResumes}
          onStopGenerateResumes={onStopGenerateResumes}
          onRemoveResumes={onRemoveResumes}
          onStopRemoveResumes={onStopRemoveResumes}
          onRecommendResumes={onRecommendResumes}
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

        <div className="border-t border-border/60 flex items-center justify-between gap-3 px-3 py-1 flex-wrap">
          <PaginationBar
            page={page}
            pageSize={pageSize}
            total={total}
            itemCount={itemCount}
            onPageChange={onPageChange}
            onPageSizeChange={onPageSizeChange}
            pageSizeOptions={pageSizeOptions}
            detailed
            unitLabel="jobs"
            secondaryTotal={totalJobs}
            secondaryLabel="matching jobs"
            loading={loading}
            className="py-2 px-0 flex-1 min-w-0"
          />
          <button
            type="button"
            onClick={onToggleGrid}
            className={cn(
              "icon-btn border border-border shrink-0 mb-1 sm:mb-0",
              showGrid ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-secondary",
            )}
            title="Toggle grid view"
          >
            <LayoutGrid className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
