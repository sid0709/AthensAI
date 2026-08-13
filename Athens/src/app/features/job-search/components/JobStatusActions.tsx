import React from "react";
import { CalendarCheck, ExternalLink, Loader2, X, XCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip";
import type { Job } from "../../../types";

type JobStatusActionsProps = {
  job: Job;
  pending?: boolean;
  onApply: () => void;
  onMarkApplied?: () => void;
  onMarkBidReady?: () => void;
  onMarkWorkerPool?: () => void;
  onMarkScheduled: () => void;
  onMarkDeclined: () => void;
  onCancel: () => void;
  size?: "sm" | "default";
  showExternalLinkOnApply?: boolean;
};

function cancelTooltip(job: Job): string {
  if (job.status === "applied") {
    return "Cancel application — moves back to Posted";
  }
  if (job.status === "bid-ready") {
    return "Clear bid-ready — moves back to Posted";
  }
  if (job.status === "worker-pool") {
    return "Clear worker pool — moves back to Posted";
  }
  if (job.status === "bid-completed") {
    return "Clear bid-completed — moves back to Posted";
  }
  if (job.status === "scheduled" || job.status === "declined") {
    return "Cancel — moves back to Applied";
  }
  return "Cancel";
}

function StatusCancelButton({
  job,
  pending,
  onCancel,
}: {
  job: Job;
  pending: boolean;
  onCancel: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="athens-icon-btn"
          disabled={pending}
          aria-label={cancelTooltip(job)}
          onClick={onCancel}
        >
          {pending ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <X size={16} aria-hidden="true" />}
        </button>
      </TooltipTrigger>
      <TooltipContent sideOffset={6}>{cancelTooltip(job)}</TooltipContent>
    </Tooltip>
  );
}

function ApplyButton({
  pending,
  onApply,
  showExternalLinkOnApply,
  label = "Apply",
}: {
  pending: boolean;
  onApply: () => void;
  size: "sm" | "default";
  showExternalLinkOnApply: boolean;
  label?: string;
}) {
  return (
    <button type="button" className="athens-btn-primary" disabled={pending} onClick={onApply}>
      {pending ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : null}
      {label}
      {showExternalLinkOnApply ? <ExternalLink size={16} aria-hidden="true" /> : null}
    </button>
  );
}

function MarkAppliedButton({
  pending,
  onMarkApplied,
}: {
  pending: boolean;
  onMarkApplied: () => void;
  size: "sm" | "default";
}) {
  return (
    <button
      type="button"
      className="athens-btn"
      disabled={pending}
      onClick={(event) => {
        event.stopPropagation();
        onMarkApplied();
      }}
      title="Mark as applied without opening the apply page"
    >
      {pending ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : null}
      Mark applied
    </button>
  );
}

export function JobStatusActions({
  job,
  pending = false,
  onApply,
  onMarkApplied,
  onMarkBidReady,
  onMarkWorkerPool,
  onMarkScheduled,
  onMarkDeclined,
  onCancel,
  size = "sm",
  showExternalLinkOnApply = true,
}: JobStatusActionsProps) {
  if (job.status === "posted") {
    return (
      <>
        {onMarkBidReady ? (
          <button type="button" className="athens-btn" disabled={pending} onClick={onMarkBidReady}>
            {pending ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : null}
            Bid ready
          </button>
        ) : null}
        {onMarkWorkerPool ? (
          <button type="button" className="athens-btn" disabled={pending} onClick={onMarkWorkerPool}>
            {pending ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : null}
            Worker pool
          </button>
        ) : null}
        {onMarkApplied ? (
          <MarkAppliedButton pending={pending} onMarkApplied={onMarkApplied} size={size} />
        ) : null}
        <ApplyButton
          pending={pending}
          onApply={onApply}
          size={size}
          showExternalLinkOnApply={showExternalLinkOnApply}
        />
      </>
    );
  }

  if (job.status === "bid-ready" || job.status === "worker-pool" || job.status === "bid-completed") {
    return (
      <>
        {onMarkApplied ? (
          <MarkAppliedButton pending={pending} onMarkApplied={onMarkApplied} size={size} />
        ) : null}
        <ApplyButton
          pending={pending}
          onApply={onApply}
          size={size}
          showExternalLinkOnApply={showExternalLinkOnApply}
        />
        <StatusCancelButton job={job} pending={pending} onCancel={onCancel} />
      </>
    );
  }

  if (job.status === "applied") {
    return (
      <>
        <button type="button" className="athens-btn" disabled={pending} onClick={onMarkScheduled}>
          {pending ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <CalendarCheck size={16} aria-hidden="true" />}
          Scheduled
        </button>
        <button
          type="button"
          className="athens-btn-danger"
          disabled={pending}
          onClick={onMarkDeclined}
        >
          {pending ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <XCircle size={16} aria-hidden="true" />}
          Declined
        </button>
        <StatusCancelButton job={job} pending={pending} onCancel={onCancel} />
      </>
    );
  }

  if (job.status === "scheduled" || job.status === "declined") {
    return <StatusCancelButton job={job} pending={pending} onCancel={onCancel} />;
  }

  return null;
}
