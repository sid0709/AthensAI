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
import { Av, Badge } from "../../../components/ui";
import { Button } from "../../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "../../../components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "../../../components/ui/avatar";
import { Separator } from "../../../components/ui/separator";
import { Skeleton } from "../../../components/ui/skeleton";
import type { Job, WorkMode } from "../../../types";
import { useJobDetail } from "../hooks/useJobDetail";
import { useJobResumeRank, useJobSkillRadar } from "../hooks/useJobSkillRadar";
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
  onMarkBidReady?: () => void;
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
    <Avatar className="size-12 ring-2 ring-border/60 shadow-sm">
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
    <span className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-secondary/40 px-2.5 py-1 text-xs font-medium text-foreground">
      {Icon ? <Icon className="size-3.5 shrink-0 text-muted-foreground" /> : null}
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
  onMarkBidReady,
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
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="border-b border-border bg-gradient-to-br from-primary/[0.06] via-card to-card px-6 py-5 pr-12">
          <div className="flex items-start gap-4">
            <CompanyLogo job={j} />
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1 pr-2">
                  <DialogTitle className="text-lg font-bold leading-snug text-foreground">
                    {j.title}
                  </DialogTitle>
                  <DialogDescription className="sr-only">
                    {j.company} job details, required skills, and how they match your profile
                  </DialogDescription>
                  <a
                    href={j.companyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
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
            <div className="mt-4 rounded-xl border border-primary/25 bg-primary/[0.07] px-4 py-3.5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-primary">
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
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={onChangeRecommendedResume}
                  >
                    Change
                  </Button>
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
          ) : onChangeRecommendedResume && j.status === "bid-ready" ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed border-border px-4 py-3">
              <p className="text-sm text-muted-foreground">
                No Library resume assigned yet.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onChangeRecommendedResume}
              >
                Choose Library resume
              </Button>
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
          ) : (
            <p className="mt-3 text-xs text-muted-foreground">
              Select jobs on Bid ready and click <span className="font-semibold">Recommend resumes</span>{" "}
              to choose a Library stack.
            </p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 subtle-scroll space-y-6">
          <DetectedSkillsPanel
            aiSkills={displayJob.aiSkills}
          />

          {displayJob.industries.length > 0 ? (
            <section>
              <h3 className="mb-3 text-sm font-bold text-foreground">Company focus</h3>
              <div className="flex flex-wrap gap-1.5">
                {displayJob.industries.map((tag) => (
                  <Badge key={tag} v="subtle">
                    {tag}
                  </Badge>
                ))}
              </div>
            </section>
          ) : null}

          {(displayJob.skills.length > 0 || displayJob.industries.length > 0) && <Separator />}

          {skillMatchOpen ? (
            <section className="rounded-xl border border-primary/20 bg-primary/[0.03] p-4">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="inline-flex size-8 items-center justify-center rounded-lg bg-primary/10">
                    <Sparkles className="size-4 text-primary" />
                  </span>
                  <div>
                    <h3 className="text-sm font-bold text-foreground">AI skill match</h3>
                    <p className="text-xs text-muted-foreground">
                      Required skills vs your resume — graph bridges related skills
                    </p>
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setSkillMatchOpen(false)}>
                  Hide
                </Button>
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

        <DialogFooter className="border-t border-border bg-card px-6 py-4 sm:justify-between">
          <div className="flex w-full sm:w-auto items-center justify-end gap-2">
            <Button
              variant={skillMatchOpen ? "secondary" : "outline"}
              onClick={() => setSkillMatchOpen((v) => !v)}
            >
              <Sparkles className="size-4 text-primary" />
              Skill match
            </Button>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            {onApply ? (
              <JobStatusActions
                job={displayJob}
                pending={statusPending}
                onApply={onApply}
                onMarkBidReady={onMarkBidReady}
                onMarkScheduled={() => onMarkScheduled?.()}
                onMarkDeclined={() => onMarkDeclined?.()}
                onCancel={() => onCancel?.()}
                size="default"
                showExternalLinkOnApply={false}
              />
            ) : (
              <Button asChild>
                <a href={j.applyUrl} target="_blank" rel="noopener noreferrer">
                  Apply on company site
                  <ExternalLink className="size-4" />
                </a>
              </Button>
            )}
          </div>
        </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
