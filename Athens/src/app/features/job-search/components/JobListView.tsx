import React, { useCallback, useMemo, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "../../../lib/utils";
import type { CompanyJobGroup, Job } from "../../../types";
import type { JobResumeGenerationState } from "../hooks/useJobResumeGeneration";
import { CompanyJobGroupCard } from "./CompanyJobGroupCard";

type JobListViewProps = {
  groups: CompanyJobGroup[];
  expandedCompanyId?: string;
  onExpandedChange?: (companyId: string, expanded: boolean) => void;
  activeJobIds?: Record<string, string>;
  onActiveJobChange?: (companyId: string, jobId: string) => void;
  onLoadCompanyMembers?: (companyId: string) => void;
  onRemoveOtherCompanyJobs?: (group: CompanyJobGroup, activeJob: Job) => Promise<void>;
  memberLoadingIds?: Set<string>;
  memberErrors?: Record<string, string>;
  layout?: "list" | "grid";
  selectedIds?: Set<string>;
  onSelectJob?: (id: string, shiftKey: boolean) => void;
  bookmarkedIds?: Set<string>;
  onToggleBookmark?: (id: string) => void;
  isJobPending?: (jobId: string) => boolean;
  onApply?: (job: Job) => void;
  onMarkBidReady?: (job: Job) => void;
  onMarkScheduled?: (job: Job) => void;
  onMarkDeclined?: (job: Job) => void;
  onCancel?: (job: Job) => void;
  resumeStates?: Record<string, JobResumeGenerationState>;
  onGenerateResume?: (job: Job) => void;
  onPatchJob?: (job: Job) => void;
};

export function JobListView({
  groups,
  expandedCompanyId,
  onExpandedChange,
  activeJobIds,
  onActiveJobChange,
  onLoadCompanyMembers,
  onRemoveOtherCompanyJobs,
  memberLoadingIds,
  memberErrors,
  layout = "list",
  selectedIds,
  onSelectJob,
  bookmarkedIds,
  onToggleBookmark,
  isJobPending,
  onApply,
  onMarkBidReady,
  onMarkScheduled,
  onMarkDeclined,
  onCancel,
  resumeStates,
  onGenerateResume,
  onPatchJob,
}: JobListViewProps) {
  const displayGroups = useMemo(() => groups, [groups]);
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null);
  const listRef = useCallback((node: HTMLDivElement | null) => {
    setScrollElement(node?.closest<HTMLElement>("[data-page-scroll-container]") ?? null);
  }, []);
  const getItemKey = useCallback(
    (index: number) => displayGroups[index]?.companyId ?? index,
    [displayGroups],
  );
  // Keep measurements by company and let ResizeObserver update only the row
  // whose card/tray changed. Calling virtualizer.measure() here clears every
  // cached height, leaving unchanged rows stuck at estimateSize until remount.
  const virtualizer = useVirtualizer({
    count: layout === "list" ? displayGroups.length : 0,
    getScrollElement: () => scrollElement,
    getItemKey,
    estimateSize: () => 260,
    overscan: 4,
  });

  const renderGroup = (group: CompanyJobGroup) => {
    const job = group.jobs[0];
    if (!job) return null;
    return (
      <CompanyJobGroupCard
        key={group.companyId}
        group={group}
        expanded={expandedCompanyId === group.companyId}
        onExpandedChange={(expanded) => onExpandedChange?.(group.companyId, expanded)}
        activeJobId={activeJobIds?.[group.companyId]}
        onActiveJobChange={(jobId) => onActiveJobChange?.(group.companyId, jobId)}
        selectedIds={selectedIds}
        onSelectJob={onSelectJob}
        bookmarkedIds={bookmarkedIds}
        onToggleBookmark={onToggleBookmark}
        isJobPending={isJobPending}
        onApply={onApply}
        onMarkBidReady={onMarkBidReady}
        onMarkScheduled={onMarkScheduled}
        onMarkDeclined={onMarkDeclined}
        onCancel={onCancel}
        resumeStates={resumeStates}
        onGenerateResume={onGenerateResume}
        onPatchJob={onPatchJob}
        onLoadMore={onLoadCompanyMembers}
        onRemoveOtherJobs={onRemoveOtherCompanyJobs
          ? (activeJob) => onRemoveOtherCompanyJobs(group, activeJob)
          : undefined}
        loadingMore={memberLoadingIds?.has(group.companyId)}
        memberError={memberErrors?.[group.companyId]}
      />
    );
  };

  if (displayGroups.length === 0) {
    return (
      <div className="py-16 text-center text-muted-foreground text-sm">
        No jobs match your filters.
      </div>
    );
  }

  if (layout === "grid") {
    return (
      <div className={cn("grid grid-cols-1 items-start gap-4 py-2 md:grid-cols-2 xl:grid-cols-3")}>
        {displayGroups.map(renderGroup)}
      </div>
    );
  }

  return (
    <div ref={listRef} className="relative py-2" style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((virtualRow) => {
        const group = displayGroups[virtualRow.index];
        return (
          <div
            key={group.companyId}
            data-index={virtualRow.index}
            ref={virtualizer.measureElement}
            className="absolute left-0 top-0 w-full pb-4"
            style={{ transform: `translateY(${virtualRow.start}px)` }}
          >
            {renderGroup(group)}
          </div>
        );
      })}
    </div>
  );
}
