import React from "react";
import { RefreshCw } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../../components/ui/alert-dialog";
import { Button } from "../../../components/ui/button";

type RecommendResumeConflictDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  alreadyCount: number;
  totalCount: number;
  onReplace: () => void;
  onSkip: () => void;
  busy?: boolean;
};

export function RecommendResumeConflictDialog({
  open,
  onOpenChange,
  alreadyCount,
  totalCount,
  onReplace,
  onSkip,
  busy = false,
}: RecommendResumeConflictDialogProps) {
  const alreadyNoun = alreadyCount === 1 ? "job" : "jobs";
  const fresh = Math.max(0, totalCount - alreadyCount);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <RefreshCw className="w-5 h-5 text-primary shrink-0" />
            Already recommended
          </AlertDialogTitle>
          <AlertDialogDescription className="text-sm leading-relaxed">
            {alreadyCount} of {totalCount} selected {alreadyNoun} already{" "}
            {alreadyCount === 1 ? "has" : "have"} a Library resume recommendation.
            Replace with a new AI recommendation, or skip those and only run AI on
            jobs that do not have one yet
            {fresh > 0 ? ` (${fresh} remaining)` : ""}?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:gap-2">
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button variant="outline" disabled={busy} onClick={onSkip}>
            Skip existing
          </Button>
          <Button disabled={busy} onClick={onReplace}>
            Replace
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
