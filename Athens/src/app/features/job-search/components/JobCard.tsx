import React, { useState } from "react";
import {
  Bookmark,
  Building2,
  CheckCircle2,
  ExternalLink,
  FileText,
  Loader2,
  MapPin,
  Sparkles,
  Wifi,
} from "lucide-react";
import { Av, Badge, Score } from "../../../components/ui";
import { Button } from "../../../components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "../../../components/ui/avatar";
import { cn } from "../../../lib/utils";
import type { BadgeVariant, Job } from "../../../types";
import { useApplier } from "@/context/applier-context";
import { JobDescriptionDialog } from "./JobDescriptionDialog";
import { JobResumePreviewDialog } from "./JobResumePreviewDialog";
import { JobStatusActions } from "./JobStatusActions";
import type { JobResumeGenerationState } from "../hooks/useJobResumeGeneration";

const STATUS_LABELS: Record<Job["status"], string> = {
  posted: "Posted",
  "bid-ready": "Bid ready",
  "bid-completed": "Bid completed",
  applied: "Applied",
  scheduled: "Scheduled",
  declined: "Declined",
};

const STATUS_VARIANTS: Record<Job["status"], BadgeVariant> = {
  posted: "blue",
  "bid-ready": "blue",
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

const INTERACTIVE = "a, button, input, textarea, select, [data-no-select]";

type JobCardProps = {
  job: Job;
  className?: string;
  selected?: boolean;
  onSelect?: (shiftKey: boolean) => void;
  showScores?: boolean;
  bookmarked?: boolean;
  onToggleBookmark?: () => void;
  statusPending?: boolean;
  onApply?: () => void;
  onMarkBidReady?: () => void;
  onMarkScheduled?: () => void;
  onMarkDeclined?: () => void;
  onCancel?: () => void;
  onJobScoresUpdated?: (job: Job) => void;
  resumeState?: JobResumeGenerationState;
  onGenerateResume?: () => void;
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

function InfoChip({ children }: { children: React.ReactNode }) {
  return <Badge v="subtle">{children}</Badge>;
}

function MiniScore({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5 px-2 py-1 rounded-lg bg-secondary/60 border border-border/60 min-w-[52px]">
      <span className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</span>
      <span className="text-xs font-bold text-foreground tabular-nums">{value}</span>
      {hint ? <span className="text-[9px] text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

const MAX_SKILL_CHIPS = 8;

function analyzedSkillLabels(job: Job): string[] {
  if (job.aiSkills?.length) {
    return [...job.aiSkills]
      .sort((a, b) => b.requirement - a.requirement || a.name.localeCompare(b.name))
      .map((s) => s.name);
  }
  return job.skills;
}

export function JobCard({
  job,
  className,
  selected,
  onSelect,
  showScores = true,
  bookmarked = false,
  onToggleBookmark,
  statusPending = false,
  onApply,
  onMarkBidReady,
  onMarkScheduled,
  onMarkDeclined,
  onCancel,
  onJobScoresUpdated,
  resumeState,
  onGenerateResume,
}: JobCardProps) {
  const [jdOpen, setJdOpen] = useState(false);
  const [resumeOpen, setResumeOpen] = useState(false);
  const { applier } = useApplier();
  const resumeReady = resumeState?.status === "done";
  const skillLabels = analyzedSkillLabels(job);
  const visibleSkills = skillLabels.slice(0, MAX_SKILL_CHIPS);
  const hiddenSkillCount = skillLabels.length - visibleSkills.length;

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
          "group bg-card border-2 rounded-xl p-5 shadow-sm flex flex-col gap-4 transition-all duration-150",
          onSelect && "cursor-pointer select-none",
          selected
            ? "border-primary shadow-[0_0_0_1px_hsl(var(--primary)/0.25)] bg-primary/[0.03]"
            : "border-transparent ring-1 ring-border hover:shadow-md hover:ring-primary/20",
          className,
        )}
      >
        <div className="flex items-start gap-3">
          <CompanyLogo job={job} />
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-base font-bold text-foreground leading-tight truncate">{job.title}</h3>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1.5">
                  <a
                    href={job.companyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline truncate select-text"
                    data-no-select
                  >
                    <Building2 className="w-3.5 h-3.5 shrink-0" />
                    {job.company}
                    <ExternalLink className="w-3 h-3 shrink-0 opacity-60" />
                  </a>
                  <span className="text-xs text-muted-foreground">· {job.posted}</span>
                </div>
              </div>
              <div className="flex flex-col items-end gap-2 shrink-0">
                <Score score={job.scores.skill} />
                <Badge v={STATUS_VARIANTS[job.status]}>{STATUS_LABELS[job.status]}</Badge>
              </div>
            </div>
          </div>
        </div>

        {showScores && (
          <div className="flex flex-wrap gap-2">
            <MiniScore
              label="Skill"
              value={job.scores.skill}
              hint={
                job.scores.skillsRequired
                  ? `${job.scores.skillsCovered ?? 0}/${job.scores.skillsRequired} skills`
                  : undefined
              }
            />
          </div>
        )}

        {visibleSkills.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {visibleSkills.map((skill) => (
              <Badge key={skill} v="blue">
                {skill}
              </Badge>
            ))}
            {hiddenSkillCount > 0 ? (
              <Badge v="subtle">+{hiddenSkillCount} more</Badge>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-1.5">
          <InfoChip>
            <span className="inline-flex items-center gap-1">
              <MapPin className="w-3 h-3" />
              {job.location}
            </span>
          </InfoChip>
          <InfoChip>
            <span className="inline-flex items-center gap-1">
              <Wifi className="w-3 h-3" />
              {WORK_MODE_LABELS[job.workMode]}
            </span>
          </InfoChip>
          <InfoChip>{job.type}</InfoChip>
          <InfoChip>{job.seniority}</InfoChip>
          <InfoChip>{job.salary}</InfoChip>
        </div>

        <div className="flex items-center justify-between gap-3 pt-1 border-t border-border/60">
          <span className="text-xs text-muted-foreground truncate">
            {job.catalog === "external" ? `External · ${job.source}` : job.source}
          </span>
          <div className="flex items-center gap-2 shrink-0" data-no-select>
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                setJdOpen(true);
              }}
            >
              <FileText className="w-4 h-4" />
              View JD
            </Button>
            {onGenerateResume ? (
              <Button
                variant="outline"
                size="sm"
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
                className={cn(
                  resumeReady &&
                    "text-emerald-600 border-emerald-500/40 hover:text-emerald-700",
                  resumeState?.status === "error" &&
                    "text-rose-600 border-rose-500/40 hover:text-rose-700",
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  if (resumeReady) setResumeOpen(true);
                  else onGenerateResume();
                }}
              >
                {resumeState?.status === "generating" ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : resumeReady ? (
                  <CheckCircle2 className="w-4 h-4" />
                ) : (
                  <Sparkles className="w-4 h-4" />
                )}
                {resumeState?.status === "generating"
                  ? "Generating…"
                  : resumeReady
                    ? "View résumé"
                    : "Generate résumé"}
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              title={bookmarked ? "Unsave" : "Save job"}
              onClick={(e) => {
                e.stopPropagation();
                onToggleBookmark?.();
              }}
            >
              <Bookmark className={cn("w-4 h-4", bookmarked && "fill-current text-primary")} />
            </Button>
            <JobStatusActions
              job={job}
              pending={statusPending}
              onApply={() => onApply?.()}
              onMarkBidReady={onMarkBidReady ? () => onMarkBidReady() : undefined}
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
        onMarkBidReady={onMarkBidReady ? () => onMarkBidReady() : undefined}
        onMarkScheduled={() => onMarkScheduled?.()}
        onMarkDeclined={() => onMarkDeclined?.()}
        onCancel={() => onCancel?.()}
        onJobScoresUpdated={onJobScoresUpdated}
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
