import React, { useEffect, useState } from "react";
import { BookMarked } from "lucide-react";
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
import { Checkbox } from "../../../components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "../../../components/ui/radio-group";
import type { RecommendNewDestination } from "../lib/recommendNewJobs";

type RecommendNewJobsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobCount: number;
  applyAllCompanyRoles: boolean;
  showWorkerPool: boolean;
  busy?: boolean;
  onConfirm: (choice: {
    destination: RecommendNewDestination;
    autoSwap: boolean;
  }) => void;
};

export function RecommendNewJobsDialog({
  open,
  onOpenChange,
  jobCount,
  applyAllCompanyRoles,
  showWorkerPool,
  busy = false,
  onConfirm,
}: RecommendNewJobsDialogProps) {
  const [destination, setDestination] = useState<RecommendNewDestination>("bid-ready");
  const [autoSwap, setAutoSwap] = useState(true);
  const noun = jobCount === 1 ? "job" : "jobs";
  const queueLabel = destination === "worker-pool" ? "Worker pool" : "Bid ready";

  useEffect(() => {
    if (!open) return;
    setDestination("bid-ready");
    setAutoSwap(true);
  }, [open]);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <BookMarked className="w-5 h-5 text-primary shrink-0" />
            Recommend resumes
          </AlertDialogTitle>
          <AlertDialogDescription className="text-sm leading-relaxed">
            Score {jobCount} selected New {noun} against your Library. A job moves
            into the queue only when a Library resume matches. Customized results
            stay in New.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {showWorkerPool ? (
          <RadioGroup
            value={destination}
            onValueChange={(value) =>
              setDestination(value === "worker-pool" ? "worker-pool" : "bid-ready")
            }
            className="gap-2"
          >
            <label className="flex items-center gap-2 text-sm">
              <RadioGroupItem value="bid-ready" id="recommend-dest-bid-ready" disabled={busy} />
              <span>Bid ready</span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <RadioGroupItem value="worker-pool" id="recommend-dest-worker-pool" disabled={busy} />
              <span>Worker pool</span>
            </label>
          </RadioGroup>
        ) : (
          <p className="text-sm text-muted-foreground">
            Matching jobs will move to <span className="font-medium text-foreground">Bid ready</span>.
          </p>
        )}

        {applyAllCompanyRoles ? (
          <div className="space-y-2 rounded-md border border-border/60 p-3">
            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={autoSwap}
                onCheckedChange={(checked) => setAutoSwap(checked === true)}
                disabled={busy}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium text-foreground">Auto-swap</span>
                <span className="block text-muted-foreground">
                  Score the newest role first, then the next, until a Library resume
                  matches. That job moves to {queueLabel}; other New roles at the
                  company are marked applied. If none match, nothing moves.
                </span>
              </span>
            </label>
          </div>
        ) : null}

        <AlertDialogFooter className="gap-2 sm:gap-2">
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button
            disabled={busy}
            onClick={() =>
              onConfirm({
                destination: showWorkerPool ? destination : "bid-ready",
                autoSwap: applyAllCompanyRoles ? autoSwap : false,
              })
            }
          >
            Recommend
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
