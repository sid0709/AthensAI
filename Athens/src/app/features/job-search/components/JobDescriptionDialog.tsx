import React, { useEffect, useState } from "react";
import {
  Briefcase,
  Building2,
  Clock,
  ExternalLink,
  GraduationCap,
  MapPin,
  Sparkles,
  Users,
  Wifi,
} from "lucide-react";
import { Av } from "../../../components/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../../../components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "../../../components/ui/avatar";
import { Separator } from "../../../components/ui/separator";
import { Skeleton } from "../../../components/ui/skeleton";
import type { Job, WorkMode } from "../../../types";
import { useJobDetail } from "../hooks/useJobDetail";
import { useJobResumeRank, useJobSkillRadar } from "../hooks/useJobSkillRadar";
import { canAssignLibraryResume } from "../lib/jobRecommendSnapshot";
import { JobSkillMatchPanel } from "./JobSkillMatchPanel";
import { DetectedSkillsPanel } from "./DetectedSkillsPanel";
import { JobStatusActions } from "./JobStatusActions";

const WORK_MODE_LABELS: Record<WorkMode, string> = {
  remote: "Remote",
  hybrid: "Hybrid",
  onsite: "On-site",
};

type JobDescriptionDialogProps = {
  job: Job;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  statusPending?: boolean;
  onApply?: () => void;
  onMarkApplied?: () => void;
  onMarkBidReady?: () => void;
  onMarkWorkerPool?: () => void;
  onMarkScheduled?: () => void;
  onMarkDeclined?: () => void;
  onCancel?: () => void;
  onChangeRecommendedResume?: () => void;
};

function CompanyLogo({ job }: { job: Job }) {
  const [failed, setFailed] = useState(false);

  if (failed || !job.logoUrl) {
    return <Av name={job.company} size="md" />;
  }

  return (
    <Avatar className="size-12">
      <AvatarImage src={job.logoUrl} alt={`${job.company} logo`} onError={() => setFailed(true)} />
      <AvatarFallback className="p-0">
        <Av name={job.company} size="md" />
      </AvatarFallback>
    </Avatar>
  );
}

function MetaChip({
  icon: Icon,
  children,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <span className="athens-chip">
      {Icon ? <Icon className="size-3.5 shrink-0" /> : null}
      {children}
    </span>
  );
}

function DescriptionSkeleton() {
  return (
    <div className="space-y-4 py-2">
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-[92%]" />
      <Skeleton className="h-4 w-[88%]" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-[75%]" />
    </div>
  );
}

function JobDescriptionBody({ job, loading }: { job: Job; loading: boolean }) {
  if (loading) return <DescriptionSkeleton />;

  return (
    <p className="text-sm leading-relaxed text-foreground/90 whitespace-pre-line">{job.jobDescription}</p>
  );
}

export function JobDescriptionDialog({
  job,
  open,
  onOpenChange,
  statusPending = false,
  onApply,
  onMarkApplied,
  onMarkBidReady,
  onMarkWorkerPool,
  onMarkScheduled,
  onMarkDeclined,
  onCancel,
  onChangeRecommendedResume,
}: JobDescriptionDialogProps) {
  const { displayJob: detailJob, loading, error } = useJobDetail(job, open);
  const j = detailJob ?? job;
  const [skillMatchOpen, setSkillMatchOpen] = useState(false);

  const jobId = j.backendId || j.id;
  const { data: resumeRank, loading: resumeRankLoading } = useJobResumeRank(jobId, open);
  const {
    data: radarData,
    loading: radarLoading,
    error: radarError,
    selectedResumeId,
    changeResume,
  } = useJobSkillRadar(jobId, open && skillMatchOpen, {
    recommendedResumeId: resumeRank?.recommendedResumeId ?? undefined,
    recommendedTechStack: resumeRank?.recommendedResumeTechStack ?? undefined,
  });

  useEffect(() => {
    if (!open) {
      setSkillMatchOpen(false);
    }
  }, [open]);
  const displayJob = j;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="athens-ui athens-dialog flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="athens-dialog-header">
          <div className="flex items-start gap-4">
            <CompanyLogo job={j} />
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1 pr-2">
                  <DialogTitle className="athens-card-title text-lg">
                    {j.title}
                  </DialogTitle>
                  <DialogDescription className="sr-only">
                    {j.company} job details, required skills, and how they match your profile
                  </DialogDescription>
                  <a
                    href={j.companyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="athens-link mt-1 inline-flex items-center gap-1"
                  >
                    <Building2 className="size-3.5 shrink-0" />
                    {j.company}
                    <ExternalLink className="size-3 shrink-0 opacity-60" />
                  </a>
                </div>
              </div>
              <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Clock className="size-3.5" />
                  {j.postedAgo || j.posted}
                </span>
                <span>·</span>
                <span>{j.source}</span>
              </p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <MetaChip icon={MapPin}>{j.location}</MetaChip>
            <MetaChip icon={Wifi}>{WORK_MODE_LABELS[j.workMode]}</MetaChip>
            <MetaChip icon={Briefcase}>{j.type}</MetaChip>
            <MetaChip icon={GraduationCap}>{j.seniority}</MetaChip>
            {j.experience ? <MetaChip>{j.experience}</MetaChip> : null}
            {j.salary !== "Undisclosed" ? <MetaChip>{j.salary}</MetaChip> : null}
            {j.applicantsText ? (
              <MetaChip icon={Users}>{j.applicantsText}</MetaChip>
            ) : null}
          </div>

          {j.recommendedResumeStack || j.useCustomizedResume ? (
            <div className="mt-4 athens-callout">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="athens-eyebrow">
                    Recommended resume
                    {j.recommendMode === "manual" ? " · manual" : null}
                  </p>
                  <p className="mt-1 text-base font-bold leading-snug text-foreground">
                    {j.recommendedResumeStack
                      ? j.recommendedResumeStack
                      : "Customized resume"}
                  </p>
                </div>
                {onChangeRecommendedResume ? (
                  <button
                    type="button"
                    className="athens-btn shrink-0"
                    onClick={onChangeRecommendedResume}
                  >
                    Change
                  </button>
                ) : null}
              </div>
              {j.recommendedResumeReason ? (
                <p className="mt-1.5 text-sm leading-relaxed text-foreground/80">
                  {j.recommendedResumeReason}
                </p>
              ) : null}
              {j.recommendWarning ? (
                <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-300">
                  {j.recommendWarning}
                </p>
              ) : null}
            </div>
          ) : onChangeRecommendedResume && canAssignLibraryResume(j.status) ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 athens-callout" style={{ borderStyle: "dashed" }}>
              <p className="text-sm text-[var(--athens-text-secondary)]">
                No Library resume assigned yet.
              </p>
              <button
                type="button"
                className="athens-btn"
                onClick={onChangeRecommendedResume}
              >
                Choose Library resume
              </button>
            </div>
          ) : resumeRank?.recommendedResumeTechStack ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Coverage best fit:{" "}
              <span className="font-semibold text-foreground">
                {resumeRank.recommendedResumeTechStack}
              </span>{" "}
              resume
            </p>
          ) : resumeRankLoading ? (
            <p className="mt-3 text-xs text-muted-foreground">Finding best resume match…</p>
          ) : canAssignLibraryResume(j.status) ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Select jobs and click <span className="font-semibold">Recommend resumes</span>{" "}
              to choose a Library stack.
            </p>
          ) : null}
        </div>

        <div className="athens-dialog-body subtle-scroll space-y-6">
          <DetectedSkillsPanel
            aiSkills={displayJob.aiSkills}
          />

          {displayJob.industries.length > 0 ? (
            <section>
              <h3 className="mb-3 text-sm font-bold text-foreground">Company focus</h3>
              <div className="flex flex-wrap gap-1.5">
                {displayJob.industries.map((tag) => (
                  <span key={tag} className="athens-chip">
                    {tag}
                  </span>
                ))}
              </div>
            </section>
          ) : null}

          {(displayJob.skills.length > 0 || displayJob.industries.length > 0) && <Separator />}

          {skillMatchOpen ? (
            <section className="athens-callout">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="athens-icon-btn" aria-hidden="true">
                    <Sparkles size={16} />
                  </span>
                  <div>
                    <h3 className="text-sm font-semibold">AI skill match</h3>
                    <p className="text-xs text-[var(--athens-text-muted)]">
                      Required skills vs your resume — graph bridges related skills
                    </p>
                  </div>
                </div>
                <button type="button" className="athens-text-btn" onClick={() => setSkillMatchOpen(false)}>
                  Hide
                </button>
              </div>
              <JobSkillMatchPanel
                data={radarData}
                loading={radarLoading}
                error={radarError}
                selectedResumeId={selectedResumeId}
                onResumeChange={changeResume}
              />
            </section>
          ) : null}

          {skillMatchOpen ? <Separator /> : null}

          <section>
            <h3 className="mb-4 text-sm font-bold text-foreground">Job description</h3>
            {error ? (
              <p className="mb-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                {error}. Showing available summary.
              </p>
            ) : null}
            <JobDescriptionBody job={displayJob} loading={loading} />
          </section>
        </div>

        <div className="athens-dialog-footer">
            <button
              type="button"
              className="athens-btn"
              onClick={() => setSkillMatchOpen((v) => !v)}
            >
              <Sparkles size={16} aria-hidden="true" />
              Skill match
            </button>
            <button type="button" className="athens-btn" onClick={() => onOpenChange(false)}>
              Close
            </button>
            {onApply ? (
              <JobStatusActions
                job={displayJob}
                pending={statusPending}
                onApply={onApply}
                onMarkApplied={onMarkApplied}
                onMarkBidReady={onMarkBidReady}
                onMarkWorkerPool={onMarkWorkerPool}
                onMarkScheduled={() => onMarkScheduled?.()}
                onMarkDeclined={() => onMarkDeclined?.()}
                onCancel={() => onCancel?.()}
                size="default"
                showExternalLinkOnApply={false}
              />
            ) : (
              <a href={j.applyUrl} target="_blank" rel="noopener noreferrer" className="athens-btn-primary">
                Apply on company site
                <ExternalLink size={16} aria-hidden="true" />
              </a>
            )}
        </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
