import React from "react";
import { ClipboardList, Download, Loader2, Sparkles, Trash2 } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Checkbox } from "../../../components/ui/checkbox";
import { Progress } from "../../../components/ui/progress";
import { cn } from "../../../lib/utils";
import type { JobResumeBulkProgress } from "../hooks/useJobResumeGeneration";

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
  onGenerateResumes?: () => void;
  onStopGenerateResumes?: () => void;
  resumeGenerating?: boolean;
  resumeProgress?: JobResumeBulkProgress;
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
  onGenerateResumes,
  onStopGenerateResumes,
  resumeGenerating = false,
  resumeProgress,
  embedded = false,
  className,
}: JobBulkActionsBarProps) {
  const indeterminate = selectedOnPage > 0 && !allOnPageSelected;
  const progressPct =
    resumeProgress && resumeProgress.total > 0
      ? Math.round(
          ((resumeProgress.done + (resumeProgress.partial ?? 0)) / resumeProgress.total) * 100,
        )
      : 0;
  const hasSelection = totalSelected > 0;

  return (
    <div className={cn("space-y-0", className)}>
      <div
        className={cn(
          "flex items-center gap-3 px-3 py-2.5",
          !embedded && "rounded-xl border border-border/60 bg-card/95 backdrop-blur-xl shadow-sm",
          embedded && "border-b border-border/40",
          hasSelection && "bg-primary/[0.02]",
        )}
      >
        <label className="inline-flex items-center gap-2.5 cursor-pointer select-none shrink-0">
          <Checkbox
            checked={
              allOnPageSelected && pageCount > 0
                ? true
                : indeterminate
                  ? "indeterminate"
                  : false
            }
            onCheckedChange={onToggleSelectAll}
            aria-label="Select all jobs on this page"
          />
          <span className="text-sm whitespace-nowrap">
            <span className="text-muted-foreground">Select page</span>
            <span className="mx-1.5 text-border">·</span>
            <span className="font-semibold text-foreground tabular-nums">
              {selectedOnPage}/{pageCount}
            </span>
            {totalSelected > selectedOnPage && (
              <span className="ml-1.5 text-xs font-medium text-primary">
                ({totalSelected} total)
              </span>
            )}
          </span>
        </label>

        {resumeGenerating && resumeProgress ? (
          <div className="hidden sm:flex flex-1 min-w-[6rem] max-w-xs items-center gap-2">
            <Progress value={progressPct} className="h-1.5 flex-1" />
            <span className="text-[11px] tabular-nums text-muted-foreground whitespace-nowrap">
              {progressPct}%
            </span>
          </div>
        ) : null}

        <div className="flex items-center gap-1.5 ml-auto">
          {onMarkBidReady ? (
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              onClick={onMarkBidReady}
              disabled={totalSelected === 0 || bidReadyPending}
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
          {onGenerateResumes ? (
            resumeGenerating ? (
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-amber-700 border-amber-200 hover:bg-amber-50 hover:text-amber-800"
                onClick={onStopGenerateResumes}
                title="Stop résumé generation immediately"
              >
                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                <span className="tabular-nums whitespace-nowrap text-xs sm:text-sm">
                  {resumeProgress ? (
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
                disabled={totalSelected === 0}
                title="Generate tailored résumés for the selected jobs (max 12 at a time)"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Generate résumés</span>
                <span className="sm:hidden">Generate</span>
              </Button>
            )
          ) : null}
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            onClick={onExport}
            disabled={totalSelected === 0}
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Export</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-rose-600 border-rose-200 hover:bg-rose-50 hover:text-rose-700"
            onClick={onRemove}
            disabled={totalSelected === 0}
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
