import React from "react";
import {
  BookMarked,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Download,
  FileX,
  Layers,
  Loader2,
  Sparkles,
  Trash2,
  Undo2,
} from "lucide-react";
import { Checkbox } from "../../../components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip";
import { cn } from "../../../lib/utils";
import type { JobResumeBulkProgress } from "../hooks/useJobResumeGeneration";
import type { RecommendResumeBulkProgress } from "../hooks/useRecommendResumes";

type JobBulkActionsBarProps = {
  totalSelected: number;
  onExport: () => void;
  onRemove: () => void;
  onMarkBidReady?: () => void;
  bidReadyPending?: boolean;
  onMarkApplied?: () => void;
  markAppliedPending?: boolean;
  onMarkWorkerPool?: () => void;
  workerPoolPending?: boolean;
  onMoveToNew?: () => void;
  moveToNewPending?: boolean;
  onGenerateResumes?: () => void;
  onStopGenerateResumes?: () => void;
  onRemoveResumes?: () => void;
  onStopRemoveResumes?: () => void;
  onRecommendResumes?: () => void;
  applyAllCompanyRoles?: boolean;
  resumeGenerating?: boolean;
  resumeStopping?: boolean;
  resumeRemoving?: boolean;
  resumeRemovalStopping?: boolean;
  recommendRunning?: boolean;
  hasSelectedResumes?: boolean;
  resumeProgress?: JobResumeBulkProgress;
  recommendProgress?: RecommendResumeBulkProgress;
  loading?: boolean;
  embedded?: boolean;
  className?: string;
};

type JobPageSelectionControlsProps = {
  selectedOnPage: number;
  pageCount: number;
  allOnPageSelected: boolean;
  onToggleSelectAll: () => void;
  applyAllCompanyRoles?: boolean;
  onApplyAllCompanyRolesChange?: (enabled: boolean) => void;
  loading?: boolean;
};

export function JobPageSelectionControls({
  selectedOnPage,
  pageCount,
  allOnPageSelected,
  onToggleSelectAll,
  applyAllCompanyRoles = false,
  onApplyAllCompanyRolesChange,
  loading = false,
}: JobPageSelectionControlsProps) {
  const indeterminate = selectedOnPage > 0 && !allOnPageSelected;
  return (
    <div className="athens-pager-select">
      <label className={cn("athens-select-label", loading ? "cursor-wait" : "cursor-pointer")}>
        <Checkbox
          checked={
            allOnPageSelected && pageCount > 0
              ? true
              : indeterminate
                ? "indeterminate"
                : false
          }
          onCheckedChange={onToggleSelectAll}
          disabled={loading}
          aria-label="Select all jobs on this page"
        />
        <span>
          Select page <strong>{loading ? "—/—" : `${selectedOnPage}/${pageCount}`}</strong>
        </span>
      </label>
      {onApplyAllCompanyRolesChange ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <label className={cn("athens-select-label", loading ? "cursor-wait" : "cursor-pointer")}>
              <Checkbox
                checked={applyAllCompanyRoles}
                onCheckedChange={(checked) => onApplyAllCompanyRolesChange(checked === true)}
                disabled={loading}
                aria-label="Apply all company roles"
              />
              <span>
                <span className="hidden sm:inline">Apply all company roles</span>
                <span className="sm:hidden">Company apply</span>
              </span>
            </label>
          </TooltipTrigger>
          <TooltipContent sideOffset={6}>
            When you Apply or Mark applied, also mark every other role at that company as applied
          </TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
}

type DestinationItem = {
  key: string;
  label: string;
  icon: React.ElementType;
  onClick: () => void;
  pending: boolean;
  title: string;
};

type ResumeItem = {
  key: string;
  label: string;
  icon: React.ElementType;
  onClick: () => void;
  disabled: boolean;
  title: string;
  busy: boolean;
};

export function JobBulkActionsBar({
  totalSelected,
  onExport,
  onRemove,
  onMarkBidReady,
  bidReadyPending = false,
  onMarkApplied,
  markAppliedPending = false,
  onMarkWorkerPool,
  workerPoolPending = false,
  onMoveToNew,
  moveToNewPending = false,
  onGenerateResumes,
  onStopGenerateResumes,
  onRemoveResumes,
  onStopRemoveResumes,
  onRecommendResumes,
  applyAllCompanyRoles = false,
  resumeGenerating = false,
  resumeStopping = false,
  resumeRemoving = false,
  resumeRemovalStopping = false,
  recommendRunning = false,
  hasSelectedResumes = false,
  resumeProgress,
  recommendProgress,
  loading = false,
  embedded = false,
  className,
}: JobBulkActionsBarProps) {
  const hasSelection = totalSelected > 0;
  const busy = resumeGenerating || resumeRemoving || recommendRunning;
  const showDock = hasSelection || busy;
  const progressPct =
    resumeProgress && resumeProgress.total > 0
      ? Math.round(
          ((resumeProgress.done + (resumeProgress.partial ?? 0)) / resumeProgress.total) * 100,
        )
      : recommendProgress && recommendProgress.total > 0
        ? Math.round((recommendProgress.done / recommendProgress.total) * 100)
        : 0;
  const destinationLocked =
    loading || markAppliedPending || bidReadyPending || workerPoolPending || moveToNewPending;
  const resumeLocked = loading || recommendRunning || resumeGenerating || resumeRemoving;

  const destinations = [
    onMarkApplied
      ? {
          key: "applied",
          label: "Applied",
          icon: CheckCircle2,
          onClick: onMarkApplied,
          pending: markAppliedPending,
          title: applyAllCompanyRoles
            ? "Mark selected jobs as applied and mark other roles at those companies as applied"
            : "Mark selected jobs as applied without opening the apply page",
        }
      : null,
    onMarkBidReady
      ? {
          key: "bid-ready",
          label: "Bid ready",
          icon: ClipboardList,
          onClick: onMarkBidReady,
          pending: bidReadyPending,
          title: "Mark selected New jobs as Bid ready for Vendor Monitor",
        }
      : null,
    onMarkWorkerPool
      ? {
          key: "worker-pool",
          label: "Worker pool",
          icon: Layers,
          onClick: onMarkWorkerPool,
          pending: workerPoolPending,
          title: applyAllCompanyRoles
            ? "Move selected jobs to Worker pool and mark other roles at those companies as applied"
            : "Move selected New jobs to Worker pool for Oak",
        }
      : null,
    onMoveToNew
      ? {
          key: "new",
          label: "New",
          icon: Undo2,
          onClick: onMoveToNew,
          pending: moveToNewPending,
          title: "Move selected Bid ready or Worker pool jobs back to New",
        }
      : null,
  ].filter((item): item is DestinationItem => item != null);

  const generateLabel = resumeGenerating
    ? resumeStopping
      ? "Stopping…"
      : resumeProgress
        ? `${resumeProgress.done}/${resumeProgress.total}${resumeProgress.active > 0 ? ` · ${resumeProgress.active} active` : ""} · Stop`
        : "Stop"
    : "Generate";

  const removeResumeLabel = resumeRemoving
    ? resumeRemovalStopping
      ? "Stopping…"
      : resumeProgress?.phase === "finalizing"
        ? "Finalizing…"
        : resumeProgress
          ? `${resumeProgress.done}/${resumeProgress.total} · Stop`
          : "Stop"
    : "Remove résumés";

  const recommendLabel =
    recommendRunning && recommendProgress
      ? `${recommendProgress.done}/${recommendProgress.total}`
      : "Recommend";

  const resumeItems = [
    onRecommendResumes
      ? {
          key: "recommend",
          label: recommendLabel,
          icon: recommendRunning ? Loader2 : BookMarked,
          onClick: onRecommendResumes,
          disabled: resumeLocked || !hasSelection,
          title: "Recommend Library resumes for selected Bid ready or Worker pool jobs using each job description",
          busy: recommendRunning,
        }
      : null,
    onGenerateResumes
      ? {
          key: "generate",
          label: generateLabel,
          icon: resumeGenerating ? Loader2 : Sparkles,
          onClick: resumeGenerating ? () => onStopGenerateResumes?.() : () => onGenerateResumes(),
          disabled: resumeGenerating
            ? resumeStopping || !onStopGenerateResumes
            : loading || !hasSelection || resumeRemoving,
          title: resumeGenerating
            ? "Stop résumé generation immediately"
            : "Generate tailored résumés for the selected jobs (max 12 at a time)",
          busy: resumeGenerating,
        }
      : null,
    onRemoveResumes
      ? {
          key: "remove-resumes",
          label: removeResumeLabel,
          icon: resumeRemoving ? Loader2 : FileX,
          onClick: resumeRemoving ? () => onStopRemoveResumes?.() : () => onRemoveResumes(),
          disabled: resumeRemoving
            ? resumeRemovalStopping || !onStopRemoveResumes
            : !hasSelection || loading || !hasSelectedResumes || resumeGenerating,
          title: resumeRemoving
            ? "Stop résumé removal immediately"
            : "Remove generated résumés for the selected jobs (jobs stay in your list)",
          busy: resumeRemoving,
        }
      : null,
  ].filter((item): item is ResumeItem => item != null);

  const showResumeProgress = (resumeGenerating || resumeRemoving) && resumeProgress;

  if (!showDock) return null;

  return (
    <div className={cn(!embedded && "athens-surface", className)}>
      <div aria-busy={loading || busy} className="athens-dock-row">
        <div className="athens-dock">
            <span className="athens-count">
              {totalSelected} selected
            </span>

            {destinations.length > 0 ? (
              <div className="athens-segment" role="group" aria-label="Move selected jobs">
                {destinations.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Tooltip key={item.key}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className={item.pending ? "is-busy" : undefined}
                          onClick={item.onClick}
                          disabled={destinationLocked}
                          aria-label={item.label}
                          title={item.title}
                        >
                          {item.pending ? (
                            <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                          ) : (
                            <Icon size={16} aria-hidden="true" />
                          )}
                          <span className="athens-segment__label">{item.label}</span>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent sideOffset={6}>{item.title}</TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
            ) : null}

            {showResumeProgress && resumeProgress ? (
              <div className="athens-progress">
                <div className="athens-progress__meta">
                  <span>
                    {resumeRemoving ? "Removing" : "Résumés"} {resumeProgress.done}/{resumeProgress.total}
                    {resumeProgress.active > 0 ? ` · ${resumeProgress.active} active` : ""}
                  </span>
                  <span>{progressPct}%</span>
                </div>
                <div className="athens-progress__track">
                  <div className="athens-progress__bar" style={{ width: `${progressPct}%` }} />
                </div>
              </div>
            ) : null}

            {resumeItems.length > 0 ? (
              <>
                <div className="athens-cluster">
                  {resumeItems.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        className="athens-btn"
                        onClick={item.onClick}
                        disabled={item.disabled}
                        title={item.title}
                      >
                        <Icon size={16} className={item.busy ? "animate-spin" : undefined} aria-hidden="true" />
                        {item.label}
                      </button>
                    );
                  })}
                </div>
                <div className="athens-cluster-menu">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button type="button" className="athens-btn" disabled={loading && !busy}>
                        {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Sparkles size={16} aria-hidden="true" />}
                        Résumés
                        <ChevronDown size={14} aria-hidden="true" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {resumeItems.map((item) => {
                        const Icon = item.icon;
                        return (
                          <DropdownMenuItem
                            key={item.key}
                            disabled={item.disabled}
                            onSelect={item.onClick}
                          >
                            <Icon size={16} className={item.busy ? "animate-spin" : undefined} aria-hidden="true" />
                            {item.label}
                          </DropdownMenuItem>
                        );
                      })}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </>
            ) : null}

            <div className="athens-dock-trailing">
              <button
                type="button"
                className="athens-btn"
                onClick={onExport}
                disabled={loading || !hasSelection}
              >
                <Download size={16} aria-hidden="true" />
                Export
              </button>
              <button
                type="button"
                className="athens-btn-danger"
                onClick={onRemove}
                disabled={loading || !hasSelection}
              >
                <Trash2 size={16} aria-hidden="true" />
                Remove
              </button>
            </div>
        </div>
      </div>
    </div>
  );
}
