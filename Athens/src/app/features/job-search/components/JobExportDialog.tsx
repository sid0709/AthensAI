import React from "react";
import { Download } from "lucide-react";
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

type JobExportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: number;
  onExportWithApply: () => void;
  onExportOnly: () => void;
  busy?: boolean;
};

export function JobExportDialog({
  open,
  onOpenChange,
  count,
  onExportWithApply,
  onExportOnly,
  busy = false,
}: JobExportDialogProps) {
  const noun = count === 1 ? "job" : "jobs";

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Download className="w-5 h-5 text-primary shrink-0" />
            Export selected {noun}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-sm leading-relaxed">
            You&apos;re about to download {count} selected {noun} as a text file.
            Would you like to mark {count === 1 ? "it" : "them"} as{" "}
            <span className="font-medium text-foreground">Applied</span> before exporting?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:gap-2">
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button variant="outline" disabled={busy} onClick={onExportOnly}>
            Export only
          </Button>
          <Button disabled={busy} onClick={onExportWithApply}>
            Mark as applied & export
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
