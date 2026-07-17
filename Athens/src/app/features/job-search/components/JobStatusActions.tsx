import React from "react";
import { CalendarCheck, ExternalLink, Loader2, X, XCircle } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip";
import type { Job } from "../../../types";

type JobStatusActionsProps = {
  job: Job;
  pending?: boolean;
  onApply: () => void;
  onMarkBidReady?: () => void;
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
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
          disabled={pending}
          aria-label={cancelTooltip(job)}
          onClick={onCancel}
        >
          {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent sideOffset={6}>{cancelTooltip(job)}</TooltipContent>
    </Tooltip>
  );
}

function ApplyButton({
  pending,
  onApply,
  size,
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
    <Button size={size} disabled={pending} onClick={onApply}>
      {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
      {label}
      {showExternalLinkOnApply ? <ExternalLink className="w-4 h-4" /> : null}
    </Button>
  );
}

export function JobStatusActions({
  job,
  pending = false,
  onApply,
  onMarkBidReady,
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
          <Button size={size} variant="outline" disabled={pending} onClick={onMarkBidReady}>
            {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Bid ready
          </Button>
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

  if (job.status === "bid-ready" || job.status === "bid-completed") {
    return (
      <>
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
        <Button size={size} variant="outline" disabled={pending} onClick={onMarkScheduled}>
          {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarCheck className="w-4 h-4" />}
          Scheduled
        </Button>
        <Button
          size={size}
          variant="outline"
          className="text-rose-600 hover:text-rose-700"
          disabled={pending}
          onClick={onMarkDeclined}
        >
          {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
          Declined
        </Button>
        <StatusCancelButton job={job} pending={pending} onCancel={onCancel} />
      </>
    );
  }

  if (job.status === "scheduled" || job.status === "declined") {
    return <StatusCancelButton job={job} pending={pending} onCancel={onCancel} />;
  }

  return null;
}
