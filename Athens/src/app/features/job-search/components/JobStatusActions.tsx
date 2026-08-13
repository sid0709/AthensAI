import React from "react";
import {
  CalendarCheck,
  CheckCircle2,
  ClipboardList,
  ExternalLink,
  Layers,
  Loader2,
  MoreHorizontal,
  X,
  XCircle,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
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
  compact?: boolean;
};

type StatusMenuItem = {
  key: string;
  label: string;
  onClick: () => void;
  icon: React.ElementType;
  danger?: boolean;
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

function StatusOverflowMenu({
  items,
  pending,
}: {
  items: StatusMenuItem[];
  pending: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="athens-icon-btn"
          disabled={pending}
          aria-label="More job actions"
          onClick={(event) => event.stopPropagation()}
        >
          {pending ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <MoreHorizontal size={16} aria-hidden="true" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <DropdownMenuItem
              key={item.key}
              disabled={pending}
              className={item.danger ? "text-destructive" : undefined}
              onSelect={item.onClick}
            >
              <Icon size={16} aria-hidden="true" />
              {item.label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
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
  compact = false,
}: JobStatusActionsProps) {
  const menuItems: StatusMenuItem[] = [];
  let showApply = false;
  let showCancel = false;

  if (job.status === "posted") {
    if (onMarkBidReady) {
      menuItems.push({ key: "bid-ready", label: "Bid ready", onClick: onMarkBidReady, icon: ClipboardList });
    }
    if (onMarkWorkerPool) {
      menuItems.push({ key: "worker-pool", label: "Worker pool", onClick: onMarkWorkerPool, icon: Layers });
    }
    if (onMarkApplied) {
      menuItems.push({ key: "mark-applied", label: "Mark applied", onClick: onMarkApplied, icon: CheckCircle2 });
    }
    showApply = true;
  } else if (job.status === "bid-ready" || job.status === "worker-pool" || job.status === "bid-completed") {
    if (onMarkApplied) {
      menuItems.push({ key: "mark-applied", label: "Mark applied", onClick: onMarkApplied, icon: CheckCircle2 });
    }
    menuItems.push({ key: "cancel", label: "Cancel", onClick: onCancel, icon: X });
    showApply = true;
    showCancel = true;
  } else if (job.status === "applied") {
    menuItems.push({ key: "scheduled", label: "Scheduled", onClick: onMarkScheduled, icon: CalendarCheck });
    menuItems.push({ key: "declined", label: "Declined", onClick: onMarkDeclined, icon: XCircle, danger: true });
    menuItems.push({ key: "cancel", label: "Cancel", onClick: onCancel, icon: X });
    showCancel = true;
  } else if (job.status === "scheduled" || job.status === "declined") {
    menuItems.push({ key: "cancel", label: "Cancel", onClick: onCancel, icon: X });
    showCancel = true;
  }

  if (compact) {
    return (
      <>
        <StatusOverflowMenu items={menuItems} pending={pending} />
        {showApply ? (
          <ApplyButton
            pending={pending}
            onApply={onApply}
            size={size}
            showExternalLinkOnApply={showExternalLinkOnApply}
          />
        ) : null}
      </>
    );
  }

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

  if (showCancel) {
    return <StatusCancelButton job={job} pending={pending} onCancel={onCancel} />;
  }

  return null;
}
