import React, { useMemo } from "react";
import { JobCard } from "./JobCard";
import { cn } from "../../../lib/utils";
import { alignJobScoreForDisplay } from "../../../lib/skill-match";
import type { Job } from "../../../types";
import type { JobResumeGenerationState } from "../hooks/useJobResumeGeneration";
import { useProfileMatchSkills } from "../hooks/useProfileMatchSkills";

type JobListViewProps = {
  jobs: Job[];
  layout?: "list" | "grid";
  selectedIds?: Set<string>;
  onSelectJob?: (id: string, shiftKey: boolean) => void;
  showScores?: boolean;
  bookmarkedIds?: Set<string>;
  onToggleBookmark?: (id: string) => void;
  isJobPending?: (jobId: string) => boolean;
  onApply?: (job: Job) => void;
  onMarkBidReady?: (job: Job) => void;
  onMarkScheduled?: (job: Job) => void;
  onMarkDeclined?: (job: Job) => void;
  onCancel?: (job: Job) => void;
  onJobScoresUpdated?: (job: Job) => void;
  resumeStates?: Record<string, JobResumeGenerationState>;
  onGenerateResume?: (job: Job) => void;
};

export function JobListView({
  jobs,
  layout = "list",
  selectedIds,
  onSelectJob,
  showScores = true,
  bookmarkedIds,
  onToggleBookmark,
  isJobPending,
  onApply,
  onMarkBidReady,
  onMarkScheduled,
  onMarkDeclined,
  onCancel,
  onJobScoresUpdated,
  resumeStates,
  onGenerateResume,
}: JobListViewProps) {
  const { matchContext } = useProfileMatchSkills();
  const displayJobs = useMemo(
    () => jobs.map((job) => alignJobScoreForDisplay(job, matchContext)),
    [jobs, matchContext],
  );

  if (displayJobs.length === 0) {
    return (
      <div className="py-16 text-center text-muted-foreground text-sm">
        No jobs match your filters.
      </div>
    );
  }

  return (
    <div
      className={cn(
        "py-2",
        layout === "grid"
          ? "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"
          : "flex flex-col gap-4",
      )}
    >
      {displayJobs.map((job) => (
        <JobCard
          key={job.id}
          job={job}
          selected={selectedIds?.has(job.id)}
          onSelect={onSelectJob ? (shiftKey) => onSelectJob(job.id, shiftKey) : undefined}
          showScores={showScores}
          bookmarked={bookmarkedIds?.has(job.id)}
          onToggleBookmark={onToggleBookmark ? () => onToggleBookmark(job.id) : undefined}
          statusPending={isJobPending?.(job.id)}
          onApply={onApply ? () => onApply(job) : undefined}
          onMarkBidReady={onMarkBidReady ? () => onMarkBidReady(job) : undefined}
          onMarkScheduled={onMarkScheduled ? () => onMarkScheduled(job) : undefined}
          onMarkDeclined={onMarkDeclined ? () => onMarkDeclined(job) : undefined}
          onCancel={onCancel ? () => onCancel(job) : undefined}
          onJobScoresUpdated={onJobScoresUpdated}
          resumeState={resumeStates?.[job.id]}
          onGenerateResume={onGenerateResume ? () => onGenerateResume(job) : undefined}
        />
      ))}
    </div>
  );
}
