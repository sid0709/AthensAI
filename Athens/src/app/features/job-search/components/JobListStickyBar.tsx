import React from "react";
import { LayoutGrid } from "lucide-react";
import { PaginationBar } from "../../../components/shared/PaginationBar";
import { cn } from "../../../lib/utils";
import { JobBulkActionsBar } from "./JobBulkActionsBar";
import type { JobResumeBulkProgress } from "../hooks/useJobResumeGeneration";

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
  resumeGenerating?: boolean;
  resumeRemoving?: boolean;
  hasSelectedResumes?: boolean;
  resumeProgress?: JobResumeBulkProgress;
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  pageSizeOptions?: number[];
  showGrid: boolean;
  onToggleGrid: () => void;
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
  resumeGenerating,
  resumeRemoving,
  hasSelectedResumes,
  resumeProgress,
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50, 100, 250, 500],
  showGrid,
  onToggleGrid,
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
          resumeGenerating={resumeGenerating}
          resumeRemoving={resumeRemoving}
          hasSelectedResumes={hasSelectedResumes}
          resumeProgress={resumeProgress}
          embedded
        />

        <div className="border-t border-border/60 flex items-center justify-between gap-3 px-3 py-1 flex-wrap">
          <PaginationBar
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={onPageChange}
            onPageSizeChange={onPageSizeChange}
            pageSizeOptions={pageSizeOptions}
            detailed
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
