import React, { useState } from "react";
import {
  Building2,
  ChevronDown,
  ChevronUp,
  Loader2,
  MapPin,
  RefreshCw,
  Trash2,
  Wifi,
} from "lucide-react";
import { Badge } from "../../../components/ui";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../../components/ui/alert-dialog";
import { Button } from "../../../components/ui/button";
import { cn } from "../../../lib/utils";
import type { BadgeVariant, CompanyJobGroup, Job } from "../../../types";
import type { JobResumeGenerationState } from "../hooks/useJobResumeGeneration";
import { JobCard } from "./JobCard";

const STATUS_LABELS: Record<Job["status"], string> = {
  posted: "Posted",
  "bid-ready": "Bid ready",
  "worker-pool": "Worker pool",
  "bid-completed": "Bid completed",
  applied: "Applied",
  scheduled: "Scheduled",
  declined: "Declined",
};

const STATUS_VARIANTS: Record<Job["status"], BadgeVariant> = {
  posted: "blue",
  "bid-ready": "blue",
  "worker-pool": "blue",
  "bid-completed": "violet",
  applied: "success",
  scheduled: "amber",
  declined: "err",
};

const WORK_MODE_LABELS: Record<Job["workMode"], string> = {
  remote: "Remote",
  hybrid: "Hybrid",
  onsite: "On-site",
};

type CompanyJobGroupCardProps = {
  group: CompanyJobGroup;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  activeJobId?: string;
  onActiveJobChange?: (jobId: string) => void;
  selectedIds?: Set<string>;
  onSelectJob?: (id: string, shiftKey: boolean) => void;
  bookmarkedIds?: Set<string>;
  onToggleBookmark?: (id: string) => void;
  isJobPending?: (jobId: string) => boolean;
  onApply?: (job: Job) => void;
  onMarkBidReady?: (job: Job) => void;
  onMarkWorkerPool?: (job: Job) => void;
  onMarkScheduled?: (job: Job) => void;
  onMarkDeclined?: (job: Job) => void;
  onCancel?: (job: Job) => void;
  resumeStates?: Record<string, JobResumeGenerationState>;
  onGenerateResume?: (job: Job) => void;
  onPatchJob?: (job: Job) => void;
  onLoadMore?: (companyId: string) => void;
  onRemoveOtherJobs?: (activeJob: Job) => Promise<void>;
  loadingMore?: boolean;
  memberError?: string;
};

function CompactRoleRow({ job, onClick }: { job: Job; onClick: () => void }) {
  return (
    <button
      type="button"
      className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-border/70 bg-background px-3 py-3 text-left transition-colors hover:border-primary/35 hover:bg-primary/[0.035] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      onClick={onClick}
    >
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-foreground">{job.title}</span>
        <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex min-w-0 items-center gap-1">
            <MapPin className="size-3 shrink-0" />
            <span className="truncate">{job.location}</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <Wifi className="size-3" />
            {WORK_MODE_LABELS[job.workMode]}
          </span>
          <span>{job.postedAt || job.posted}</span>
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-center">
        <Badge v={STATUS_VARIANTS[job.status]}>{STATUS_LABELS[job.status]}</Badge>
      </span>
    </button>
  );
}

export function CompanyJobGroupCard({
  group,
  expanded = false,
  onExpandedChange,
  activeJobId,
  onActiveJobChange,
  selectedIds,
  onSelectJob,
  bookmarkedIds,
  onToggleBookmark,
  isJobPending,
  onApply,
  onMarkBidReady,
  onMarkWorkerPool,
  onMarkScheduled,
  onMarkDeclined,
  onCancel,
  resumeStates,
  onGenerateResume,
  onPatchJob,
  onLoadMore,
  onRemoveOtherJobs,
  loadingMore = false,
  memberError,
}: CompanyJobGroupCardProps) {
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
  const [removePending, setRemovePending] = useState(false);
  const activeJob = group.jobs.find((job) => job.id === activeJobId) ?? group.jobs[0];
  if (!activeJob) return null;

  const matchingJobCount = group.matchingJobCount ?? group.jobs.length;
  const additionalRoleCount = Math.max(0, matchingJobCount - 1);
  const compactJobs = group.jobs.filter((job) => job.id !== activeJob.id);
  const trayId = `company-roles-${group.companyId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const roleLabel = additionalRoleCount === 1 ? "role" : "roles";

  return (
    <section className="min-w-0" aria-label={`${group.company.name} matching roles`}>
      <JobCard
        job={activeJob}
        selected={selectedIds?.has(activeJob.id)}
        onSelect={onSelectJob ? (shiftKey) => onSelectJob(activeJob.id, shiftKey) : undefined}
        bookmarked={bookmarkedIds?.has(activeJob.id)}
        onToggleBookmark={onToggleBookmark ? () => onToggleBookmark(activeJob.id) : undefined}
        statusPending={isJobPending?.(activeJob.id)}
        onApply={onApply ? () => onApply(activeJob) : undefined}
        onMarkBidReady={onMarkBidReady ? () => onMarkBidReady(activeJob) : undefined}
        onMarkWorkerPool={onMarkWorkerPool ? () => onMarkWorkerPool(activeJob) : undefined}
        onMarkScheduled={onMarkScheduled ? () => onMarkScheduled(activeJob) : undefined}
        onMarkDeclined={onMarkDeclined ? () => onMarkDeclined(activeJob) : undefined}
        onCancel={onCancel ? () => onCancel(activeJob) : undefined}
        resumeState={resumeStates?.[activeJob.id]}
        onGenerateResume={onGenerateResume ? () => onGenerateResume(activeJob) : undefined}
        onPatchJob={onPatchJob}
      />

      {additionalRoleCount > 0 ? (
        <div className="px-3 sm:px-4">
          <button
            type="button"
            className={cn(
              "relative z-10 -mt-px inline-flex max-w-full items-center gap-2 rounded-b-lg border border-t-0 border-sky-300 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-700 shadow-sm transition-colors hover:bg-sky-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/50 dark:border-sky-700 dark:bg-sky-950/60 dark:text-sky-200 dark:hover:bg-sky-950",
              expanded && "bg-sky-100 dark:bg-sky-950",
            )}
            aria-expanded={expanded}
            aria-controls={trayId}
            onClick={() => onExpandedChange?.(!expanded)}
          >
            <Building2 className="size-3.5 shrink-0" />
            <span className="truncate">
              +{additionalRoleCount.toLocaleString()} more {roleLabel} at {group.company.name}
            </span>
            {expanded ? <ChevronUp className="size-3.5 shrink-0" /> : <ChevronDown className="size-3.5 shrink-0" />}
          </button>
        </div>
      ) : null}

      {expanded && additionalRoleCount > 0 ? (
        <div
          id={trayId}
          className="mx-1 rounded-b-xl border border-t-0 border-border bg-secondary/20 px-3 pb-3 pt-4 sm:mx-3 sm:px-4"
          role="region"
          aria-label={`More roles at ${group.company.name}`}
        >
          <div className="space-y-2">
            {compactJobs.map((job) => (
              <CompactRoleRow
                key={job.id}
                job={job}
                onClick={() => onActiveJobChange?.(job.id)}
              />
            ))}
          </div>

          {loadingMore ? (
            <div className="mt-3 flex items-center justify-center gap-2 rounded-lg border border-dashed border-border px-3 py-3 text-xs text-muted-foreground" role="status">
              <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
              Loading roles…
            </div>
          ) : null}

          {memberError && !loadingMore ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200" role="alert">
              <span>{memberError}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => onLoadMore?.(group.companyId)}>
                <RefreshCw className="size-3.5" />
                Retry
              </Button>
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-3">
            <span className="text-xs text-muted-foreground">
              {Math.min(group.jobs.length, matchingJobCount).toLocaleString()} of {matchingJobCount.toLocaleString()} roles loaded
            </span>
            <div className="flex items-center gap-2">
              {onRemoveOtherJobs ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => setRemoveDialogOpen(true)}
                >
                  <Trash2 className="size-3.5" />
                  Delete other roles
                </Button>
              ) : null}
              {group.nextMemberOffset != null && !memberError ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={loadingMore}
                  onClick={() => onLoadMore?.(group.companyId)}
                >
                  {loadingMore ? <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" /> : null}
                  Load 10 more
                </Button>
              ) : null}
              <Button type="button" variant="ghost" size="sm" onClick={() => onExpandedChange?.(false)}>
                <ChevronUp className="size-3.5" />
                Collapse
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <AlertDialog open={removeDialogOpen} onOpenChange={(open) => !removePending && setRemoveDialogOpen(open)}>
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="size-5 shrink-0 text-destructive" />
              Permanently delete other roles?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm leading-relaxed">
              This permanently deletes every other role at {group.company.name}, including roles that haven&apos;t been loaded here yet.
              <span className="mt-2 block font-medium text-foreground">
                {activeJob.title} will be kept.
              </span>
              This action can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removePending}>Cancel</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              disabled={removePending}
              onClick={() => {
                setRemovePending(true);
                void onRemoveOtherJobs?.(activeJob)
                  .then(() => setRemoveDialogOpen(false))
                  .catch(() => undefined)
                  .finally(() => setRemovePending(false));
              }}
            >
              {removePending ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> : <Trash2 className="size-4" />}
              {removePending ? "Deleting…" : "Delete other roles"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
