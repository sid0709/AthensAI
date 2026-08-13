import React from "react";
import { BookMarked, CheckCircle2, ClipboardList, Download, FileX, Layers, Loader2, Sparkles, Trash2, Undo2 } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Checkbox } from "../../../components/ui/checkbox";
import { Progress } from "../../../components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip";
import { cn } from "../../../lib/utils";
import type { JobResumeBulkProgress } from "../hooks/useJobResumeGeneration";
import type { RecommendResumeBulkProgress } from "../hooks/useRecommendResumes";

type JobBulkActionsBarProps = {
  selectedOnPage: number;
  pageCount: number;
  totalSelected: number;
  allOnPageSelected: boolean;
  onToggleSelectAll: () => void;
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
  onApplyAllCompanyRolesChange?: (enabled: boolean) => void;
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

export function JobBulkActionsBar({
  selectedOnPage,
  pageCount,
  totalSelected,
  allOnPageSelected,
  onToggleSelectAll,
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
  onApplyAllCompanyRolesChange,
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
  const indeterminate = selectedOnPage > 0 && !allOnPageSelected;
  const progressPct =
    resumeProgress && resumeProgress.total > 0
      ? Math.round(
          ((resumeProgress.done + (resumeProgress.partial ?? 0)) / resumeProgress.total) * 100,
        )
      : recommendProgress && recommendProgress.total > 0
        ? Math.round((recommendProgress.done / recommendProgress.total) * 100)
        : 0;
  const hasSelection = totalSelected > 0;

  return (
    <div className={cn("space-y-0", className)}>
      <div
        aria-busy={loading || resumeGenerating || resumeRemoving || recommendRunning}
        className={cn(
          "flex items-center gap-3 px-3 py-2.5",
          !embedded && "rounded-xl border border-border/60 bg-card/95 backdrop-blur-xl shadow-sm",
          embedded && "border-b border-border/40",
          hasSelection && "bg-primary/[0.02]",
        )}
      >
        <label className={cn("inline-flex items-center gap-2.5 select-none shrink-0", loading ? "cursor-wait" : "cursor-pointer")}>
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
          <span className="text-sm whitespace-nowrap">
            <span className="text-muted-foreground">Select page</span>
            <span className="mx-1.5 text-border">·</span>
            <span className="font-semibold text-foreground tabular-nums">
              {loading ? "—/—" : `${selectedOnPage}/${pageCount}`}
            </span>
            {totalSelected > selectedOnPage && (
              <span className="ml-1.5 text-xs font-medium text-primary">
                ({totalSelected} total)
              </span>
            )}
          </span>
        </label>

        {onApplyAllCompanyRolesChange ? (
          <>
            <span className="h-4 w-px bg-border/80 shrink-0" aria-hidden />
            <Tooltip>
              <TooltipTrigger asChild>
                <label className={cn("inline-flex items-center gap-2 select-none shrink-0", loading ? "cursor-wait" : "cursor-pointer")}>
                  <Checkbox
                    checked={applyAllCompanyRoles}
                    onCheckedChange={(checked) => onApplyAllCompanyRolesChange(checked === true)}
                    disabled={loading}
                    aria-label="Apply all company roles"
                  />
                  <span className="text-sm whitespace-nowrap">
                    <span className={applyAllCompanyRoles ? "font-medium text-foreground" : "text-muted-foreground"}>
                      <span className="hidden sm:inline">Apply all company roles</span>
                      <span className="sm:hidden">Company apply</span>
                    </span>
                  </span>
                </label>
              </TooltipTrigger>
              <TooltipContent sideOffset={6}>
                When you Apply or Mark applied, also mark every other role at that company as applied
              </TooltipContent>
            </Tooltip>
          </>
        ) : null}

        {(resumeGenerating || resumeRemoving) && resumeProgress ? (
          <div className="hidden sm:flex flex-1 min-w-[6rem] max-w-xs items-center gap-2">
            <Progress value={progressPct} className="h-1.5 flex-1" />
            <span className="text-[11px] tabular-nums text-muted-foreground whitespace-nowrap">
              {progressPct}%
            </span>
          </div>
        ) : null}

        <div className="flex items-center gap-1.5 ml-auto">
          {onMarkApplied ? (
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              onClick={onMarkApplied}
              disabled={
                loading
                || totalSelected === 0
                || markAppliedPending
                || bidReadyPending
                || workerPoolPending
                || moveToNewPending
              }
              title={
                applyAllCompanyRoles
                  ? "Mark selected jobs as applied and mark other roles at those companies as applied"
                  : "Mark selected jobs as applied without opening the apply page"
              }
            >
              {markAppliedPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
              ) : (
                <CheckCircle2 className="w-3.5 h-3.5" />
              )}
              <span className="hidden sm:inline">Mark applied</span>
              <span className="sm:hidden">Applied</span>
            </Button>
          ) : null}
          {onMarkBidReady ? (
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              onClick={onMarkBidReady}
              disabled={loading || totalSelected === 0 || bidReadyPending || workerPoolPending || moveToNewPending || markAppliedPending}
              title="Mark selected New jobs as Bid ready for Vendor Monitor"
            >
              {bidReadyPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
              ) : (
                <ClipboardList className="w-3.5 h-3.5" />
              )}
              <span className="hidden sm:inline">Bid ready</span>
            </Button>
          ) : null}
          {onMarkWorkerPool ? (
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              onClick={onMarkWorkerPool}
              disabled={loading || totalSelected === 0 || workerPoolPending || bidReadyPending || moveToNewPending || markAppliedPending}
              title={
                applyAllCompanyRoles
                  ? "Move selected jobs to Worker pool and mark other roles at those companies as applied"
                  : "Move selected New jobs to Worker pool for Oak"
              }
            >
              {workerPoolPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
              ) : (
                <Layers className="w-3.5 h-3.5" />
              )}
              <span className="hidden sm:inline">Worker pool</span>
            </Button>
          ) : null}
          {onMoveToNew ? (
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              onClick={onMoveToNew}
              disabled={loading || totalSelected === 0 || moveToNewPending || bidReadyPending || workerPoolPending || markAppliedPending}
              title="Move selected Bid ready or Worker pool jobs back to New"
            >
              {moveToNewPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
              ) : (
                <Undo2 className="w-3.5 h-3.5" />
              )}
              <span className="hidden sm:inline">Move to New</span>
            </Button>
          ) : null}
          {onRecommendResumes ? (
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              onClick={onRecommendResumes}
              disabled={
                loading
                || totalSelected === 0
                || recommendRunning
                || resumeGenerating
                || resumeRemoving
              }
              title="Recommend Library resumes for selected Bid ready or Worker pool jobs using each job description"
            >
              {recommendRunning ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
              ) : (
                <BookMarked className="w-3.5 h-3.5" />
              )}
              <span className="hidden sm:inline">
                {recommendRunning && recommendProgress
                  ? `${recommendProgress.done}/${recommendProgress.total}`
                  : "Recommend resumes"}
              </span>
              <span className="sm:hidden">Recommend</span>
            </Button>
          ) : null}
          {onGenerateResumes ? (
            resumeGenerating ? (
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-amber-700 border-amber-200 hover:bg-amber-50 hover:text-amber-800"
                onClick={onStopGenerateResumes}
                disabled={resumeStopping}
                title="Stop résumé generation immediately"
              >
                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                <span className="tabular-nums whitespace-nowrap text-xs sm:text-sm">
                  {resumeStopping ? (
                    "Stopping…"
                  ) : resumeProgress ? (
                    <>
                      <span className="sm:hidden">
                        {resumeProgress.done}/{resumeProgress.total}
                      </span>
                      <span className="hidden sm:inline">
                        {resumeProgress.done}/{resumeProgress.total}
                        {resumeProgress.active > 0 ? ` · ${resumeProgress.active} active` : ""}
                        {" · Stop"}
                      </span>
                    </>
                  ) : (
                    "Stop"
                  )}
                </span>
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5"
                onClick={onGenerateResumes}
                disabled={loading || totalSelected === 0 || resumeRemoving}
                title="Generate tailored résumés for the selected jobs (max 12 at a time)"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Generate résumés</span>
                <span className="sm:hidden">Generate</span>
              </Button>
            )
          ) : null}
          {onRemoveResumes ? (
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "h-8 gap-1.5",
                resumeRemoving && "text-amber-700 border-amber-200 hover:bg-amber-50 hover:text-amber-800",
              )}
              onClick={resumeRemoving ? onStopRemoveResumes : onRemoveResumes}
              disabled={resumeRemoving
                ? resumeRemovalStopping || !onStopRemoveResumes
                : totalSelected === 0 || loading || !hasSelectedResumes || resumeGenerating}
              title={resumeRemoving
                ? "Stop résumé removal immediately"
                : "Remove generated résumés for the selected jobs (jobs stay in your list)"}
            >
              {resumeRemoving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                  <span className="tabular-nums whitespace-nowrap text-xs sm:text-sm">
                    {resumeRemovalStopping
                      ? "Stopping…"
                      : resumeProgress?.phase === "finalizing"
                      ? "Finalizing…"
                      : resumeProgress
                        ? `${resumeProgress.done}/${resumeProgress.total} · Stop`
                        : "Stop"}
                  </span>
                </>
              ) : (
                <>
                  <FileX className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Remove résumés</span>
                  <span className="sm:hidden">Résumés</span>
                </>
              )}
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            onClick={onExport}
            disabled={loading || totalSelected === 0}
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Export</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-rose-600 border-rose-200 hover:bg-rose-50 hover:text-rose-700"
            onClick={onRemove}
            disabled={loading || totalSelected === 0}
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Remove</span>
          </Button>
        </div>
      </div>

      {resumeGenerating && resumeProgress ? (
        <div className="sm:hidden px-3 pb-2">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
            <span>
              Résumés {resumeProgress.done}/{resumeProgress.total}
              {resumeProgress.active > 0 ? ` · ${resumeProgress.active} active` : ""}
            </span>
            <span className="tabular-nums">{progressPct}%</span>
          </div>
          <Progress value={progressPct} className="h-1" />
        </div>
      ) : null}
    </div>
  );
}
