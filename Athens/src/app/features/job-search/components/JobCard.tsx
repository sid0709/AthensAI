import React, { useState } from "react";
import {
  Bookmark,
  BookMarked,
  Building2,
  CheckCircle2,
  ExternalLink,
  FileText,
  Loader2,
  MapPin,
  Sparkles,
  Wifi,
} from "lucide-react";
import { Av } from "../../../components/ui";
import { Avatar, AvatarFallback, AvatarImage } from "../../../components/ui/avatar";
import { cn } from "../../../lib/utils";
import type { Job } from "../../../types";
import { useApplier } from "@/context/applier-context";
import { JobDescriptionDialog } from "./JobDescriptionDialog";
import { JobResumePreviewDialog } from "./JobResumePreviewDialog";
import { JobStatusActions } from "./JobStatusActions";
import { JobStatusIcon } from "./JobStatusIcon";
import { JobUrlLink } from "./JobUrlLink";
import { SwapLibraryResumeDialog } from "./SwapLibraryResumeDialog";
import { canAssignLibraryResume } from "../lib/jobRecommendSnapshot";
import type { JobResumeGenerationState } from "../hooks/useJobResumeGeneration";

const STATUS_LABELS: Record<Job["status"], string> = {
  posted: "Posted",
  "bid-ready": "Bid ready",
  "worker-pool": "Worker pool",
  "bid-completed": "Bid completed",
  applied: "Applied",
  scheduled: "Scheduled",
  declined: "Declined",
};

const WORK_MODE_LABELS: Record<Job["workMode"], string> = {
  remote: "Remote",
  hybrid: "Hybrid",
  onsite: "On-site",
};

const INTERACTIVE = "a, button, input, textarea, select, [data-no-select]";

type JobCardProps = {
  job: Job;
  className?: string;
  layout?: "list" | "grid";
  selected?: boolean;
  onSelect?: (shiftKey: boolean) => void;
  bookmarked?: boolean;
  onToggleBookmark?: () => void;
  statusPending?: boolean;
  onApply?: () => void;
  onMarkApplied?: () => void;
  onMarkBidReady?: () => void;
  onMarkWorkerPool?: () => void;
  onMarkScheduled?: () => void;
  onMarkDeclined?: () => void;
  onCancel?: () => void;
  resumeState?: JobResumeGenerationState;
  onGenerateResume?: () => void;
  onPatchJob?: (job: Job) => void;
};

function CompanyLogo({ job }: { job: Job }) {
  const [failed, setFailed] = useState(false);

  if (failed || !job.logoUrl) {
    return <Av name={job.company} size="sm" />;
  }

  return (
    <Avatar className="size-9">
      <AvatarImage src={job.logoUrl} alt={`${job.company} logo`} onError={() => setFailed(true)} />
      <AvatarFallback className="p-0">
        <Av name={job.company} size="sm" />
      </AvatarFallback>
    </Avatar>
  );
}

function analyzedSkillLabels(job: Job): string[] {
  if (job.aiSkills?.length) {
    return [...job.aiSkills]
      .sort((a, b) => b.requirement - a.requirement || a.name.localeCompare(b.name))
      .map((s) => s.name);
  }
  return job.skills;
}

function ResumeChip({
  children,
  title,
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  onClick?: () => void;
}) {
  if (onClick) {
    return (
      <button
        type="button"
        data-no-select
        className="athens-chip"
        title={title}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
      >
        <BookMarked size={12} aria-hidden="true" />
        {children}
      </button>
    );
  }
  return (
    <span className="athens-chip" title={title}>
      <BookMarked size={12} aria-hidden="true" />
      {children}
    </span>
  );
}

export function JobCard({
  job,
  className,
  layout = "list",
  selected,
  onSelect,
  bookmarked = false,
  onToggleBookmark,
  statusPending = false,
  onApply,
  onMarkApplied,
  onMarkBidReady,
  onMarkWorkerPool,
  onMarkScheduled,
  onMarkDeclined,
  onCancel,
  resumeState,
  onGenerateResume,
  onPatchJob,
}: JobCardProps) {
  const [jdOpen, setJdOpen] = useState(false);
  const [resumeOpen, setResumeOpen] = useState(false);
  const [swapOpen, setSwapOpen] = useState(false);
  const { applier } = useApplier();
  const resumeReady = resumeState?.status === "done";
  const skillLabels = analyzedSkillLabels(job);
  const maxSkills = layout === "grid" ? 4 : 6;
  const visibleSkills = skillLabels.slice(0, maxSkills);
  const hiddenSkillCount = Math.max(0, (job.skillCount ?? skillLabels.length) - visibleSkills.length);
  const canSwapLibrary = canAssignLibraryResume(job.status) && Boolean(onPatchJob);
  const isGrid = layout === "grid";

  const handleCardClick = (e: React.MouseEvent<HTMLElement>) => {
    if (!onSelect) return;
    if ((e.target as HTMLElement).closest(INTERACTIVE)) return;
    onSelect(e.shiftKey);
  };

  return (
    <>
      <article
        role={onSelect ? "button" : undefined}
        tabIndex={onSelect ? 0 : undefined}
        onClick={handleCardClick}
        onKeyDown={
          onSelect
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(e.shiftKey);
                }
              }
            : undefined
        }
        aria-pressed={onSelect ? selected : undefined}
        className={cn(
          "athens-card",
          isGrid && "athens-card--grid",
          onSelect && "cursor-pointer select-none",
          selected && "is-selected",
          className,
        )}
      >
        <div className="flex items-start gap-3">
          <CompanyLogo job={job} />
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className={cn("athens-card-title", isGrid ? "line-clamp-2" : "truncate")}>{job.title}</h3>
                <div className="athens-card-meta mt-1.5">
                  <a
                    href={job.companyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="athens-link inline-flex items-center gap-1 truncate select-text"
                    data-no-select
                  >
                    <Building2 size={14} aria-hidden="true" />
                    {job.company}
                    <ExternalLink size={12} aria-hidden="true" />
                  </a>
                  <span>· {job.posted}</span>
                </div>
              </div>
              <div className="flex flex-col items-end gap-2 shrink-0">
                <span className="athens-status">
                  <JobStatusIcon status={job.status} />
                  {STATUS_LABELS[job.status]}
                </span>
                {job.recommendedResumeStack ? (
                  <ResumeChip
                    title={
                      job.recommendedResumeReason
                        ? `${job.recommendedResumeStack} — ${job.recommendedResumeReason}${canSwapLibrary ? " (click to change)" : ""}`
                        : `Recommended Library resume: ${job.recommendedResumeStack}${canSwapLibrary ? " (click to change)" : ""}`
                    }
                    onClick={canSwapLibrary ? () => setSwapOpen(true) : undefined}
                  >
                    <span className="truncate max-w-[9rem]">{job.recommendedResumeStack}</span>
                  </ResumeChip>
                ) : job.useCustomizedResume ? (
                  <ResumeChip
                    title={
                      (job.recommendWarning || "No Library stack matched — use a customized résumé") +
                      (canSwapLibrary ? " (click to pick a Library resume)" : "")
                    }
                    onClick={canSwapLibrary ? () => setSwapOpen(true) : undefined}
                  >
                    Customized
                  </ResumeChip>
                ) : canSwapLibrary ? (
                  <ResumeChip
                    title="Assign a Library resume for this job"
                    onClick={() => setSwapOpen(true)}
                  >
                    Assign resume
                  </ResumeChip>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        {visibleSkills.length > 0 ? (
          <div className="athens-card-chips">
            <div className="athens-card-chips__list">
              {visibleSkills.map((skill) => (
                <span key={skill} className="athens-chip" title={skill}>
                  {skill}
                </span>
              ))}
            </div>
            {hiddenSkillCount > 0 ? (
              <span
                className="athens-chip athens-chip--more"
                title={skillLabels.slice(visibleSkills.length).join(", ")}
              >
                +{hiddenSkillCount}
              </span>
            ) : null}
          </div>
        ) : (
          <div className="athens-card-chips" aria-hidden="true" />
        )}

        <div className="athens-card-chips athens-card-chips--meta">
          <div className="athens-card-chips__list">
            <span className="athens-chip">
              <MapPin size={12} aria-hidden="true" />
              {job.location}
            </span>
            <span className="athens-chip">
              <Wifi size={12} aria-hidden="true" />
              {WORK_MODE_LABELS[job.workMode]}
            </span>
            {isGrid ? null : <span className="athens-chip">{job.type}</span>}
            {isGrid ? null : <span className="athens-chip">{job.seniority}</span>}
            <span className="athens-chip">{job.salary}</span>
          </div>
        </div>

        <div className="athens-card-footer">
          <span className="athens-card-source">
            {job.catalog === "external" ? `External · ${job.source}` : job.source}
          </span>
          <div className="athens-card-actions" data-no-select>
            <div className="athens-card-tools">
              <button
                type="button"
                className="athens-icon-btn"
                title="View job description"
                aria-label="View job description"
                onClick={(e) => {
                  e.stopPropagation();
                  setJdOpen(true);
                }}
              >
                <FileText size={16} aria-hidden="true" />
              </button>
              <JobUrlLink job={job} iconOnly />
              {onGenerateResume ? (
                <button
                  type="button"
                  className={cn(
                    "athens-icon-btn",
                    resumeState?.status === "error" && "athens-btn-danger",
                  )}
                  disabled={resumeState?.status === "generating"}
                  title={
                    resumeState?.status === "generating"
                      ? resumeState.step ?? "Generating résumé…"
                      : resumeState?.status === "error"
                        ? `${resumeState.error ?? "Résumé generation failed"} — click to retry`
                        : resumeReady
                          ? "Résumé already generated — click to preview the PDF"
                          : "Generate a tailored résumé for this job"
                  }
                  aria-label={
                    resumeState?.status === "generating"
                      ? "Generating résumé"
                      : resumeReady
                        ? "View résumé"
                        : "Generate résumé"
                  }
                  onClick={(e) => {
                    e.stopPropagation();
                    if (resumeReady) setResumeOpen(true);
                    else onGenerateResume();
                  }}
                >
                  {resumeState?.status === "generating" ? (
                    <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                  ) : resumeReady ? (
                    <CheckCircle2 size={16} aria-hidden="true" />
                  ) : (
                    <Sparkles size={16} aria-hidden="true" />
                  )}
                </button>
              ) : null}
              <button
                type="button"
                className="athens-icon-btn"
                title={bookmarked ? "Unsave" : "Save job"}
                aria-label={bookmarked ? "Unsave" : "Save job"}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleBookmark?.();
                }}
              >
                <Bookmark size={16} className={cn(bookmarked && "fill-current")} aria-hidden="true" />
              </button>
            </div>
            <JobStatusActions
              compact
              job={job}
              pending={statusPending}
              onApply={() => onApply?.()}
              onMarkApplied={onMarkApplied ? () => onMarkApplied() : undefined}
              onMarkBidReady={onMarkBidReady ? () => onMarkBidReady() : undefined}
              onMarkWorkerPool={onMarkWorkerPool ? () => onMarkWorkerPool() : undefined}
              onMarkScheduled={() => onMarkScheduled?.()}
              onMarkDeclined={() => onMarkDeclined?.()}
              onCancel={() => onCancel?.()}
            />
          </div>
        </div>
      </article>

      {jdOpen ? (
      <JobDescriptionDialog
        job={job}
        open
        onOpenChange={setJdOpen}
        statusPending={statusPending}
        onApply={() => onApply?.()}
        onMarkApplied={onMarkApplied ? () => onMarkApplied() : undefined}
        onMarkBidReady={onMarkBidReady ? () => onMarkBidReady() : undefined}
        onMarkWorkerPool={onMarkWorkerPool ? () => onMarkWorkerPool() : undefined}
        onMarkScheduled={() => onMarkScheduled?.()}
        onMarkDeclined={() => onMarkDeclined?.()}
        onCancel={() => onCancel?.()}
        onChangeRecommendedResume={canSwapLibrary ? () => setSwapOpen(true) : undefined}
      />
      ) : null}

      {swapOpen && canSwapLibrary ? (
        <SwapLibraryResumeDialog
          open={swapOpen}
          onOpenChange={setSwapOpen}
          job={job}
          onApplied={(next) => onPatchJob?.(next)}
        />
      ) : null}

      {resumeOpen && applier?.name ? (
        <JobResumePreviewDialog
          job={job}
          applierName={applier.name}
          open
          onOpenChange={setResumeOpen}
        />
      ) : null}
    </>
  );
}
