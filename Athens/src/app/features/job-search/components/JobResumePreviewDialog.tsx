import React from "react";
import { ExternalLink } from "lucide-react";
import { Button } from "../../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "../../../components/ui/dialog";
import { agentJobResumePdfUrl } from "../../agents/components/AgentResumePdfPreview";
import type { Job } from "../../../types";

type JobResumePreviewDialogProps = {
  job: Job;
  applierName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Preview the generated (agent draft) résumé PDF for a job. */
export function JobResumePreviewDialog({
  job,
  applierName,
  open,
  onOpenChange,
}: JobResumePreviewDialogProps) {
  const pdfUrl = agentJobResumePdfUrl(applierName, job.backendId || job.id);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogTitle className="truncate pr-8">Tailored résumé · {job.title}</DialogTitle>
        <DialogDescription className="truncate">
          {job.company} — generated for {applierName}; the Agents pipeline reuses this PDF.
        </DialogDescription>
        <iframe
          src={pdfUrl}
          title={`Tailored résumé for ${job.title}`}
          className="w-full h-[70vh] rounded-md border border-border bg-secondary/20"
        />
        <DialogFooter>
          <Button variant="outline" size="sm" asChild>
            <a href={pdfUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="w-4 h-4" />
              Open in new tab
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
