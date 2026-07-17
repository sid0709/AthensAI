import { useEffect, useState } from "react";
import { Eye, Loader2 } from "lucide-react";
import { fetchUserResume } from "../../../services/resumeApi";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";

type ResumePreviewDialogProps = {
  resumeId: string | null;
  ownerName: string;
  fileName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function base64ToBlob(base64: string, mimeType: string): Blob {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: mimeType });
}

export function ResumePreviewDialog({
  resumeId,
  ownerName,
  fileName,
  open,
  onOpenChange,
}: ResumePreviewDialogProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !resumeId || !ownerName) return;

    let objectUrl: string | null = null;
    let cancelled = false;

    setLoading(true);
    setError(null);
    setPreviewUrl(null);
    setTextContent(null);

    void fetchUserResume(resumeId, ownerName)
      .then((detail) => {
        if (cancelled) return;
        const name = fileName || detail.fileName || "resume";
        const lower = name.toLowerCase();
        const isPdf =
          detail.mimeType === "application/pdf" || lower.endsWith(".pdf");
        const isText =
          detail.mimeType === "text/plain" || lower.endsWith(".txt");

        if (detail.contentBase64 && isPdf) {
          const blob = base64ToBlob(detail.contentBase64, "application/pdf");
          objectUrl = URL.createObjectURL(blob);
          setPreviewUrl(objectUrl);
          return;
        }

        if (isText && detail.contentBase64) {
          const raw = atob(detail.contentBase64);
          setTextContent(raw);
          return;
        }

        if (detail.extractedText?.trim()) {
          setTextContent(detail.extractedText);
          return;
        }

        setError("Preview is not available for this file type. Download the file instead.");
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load preview");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [open, resumeId, ownerName, fileName]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-[95vw] h-[85vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-5 py-4 border-b border-border shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Eye className="w-4 h-4 text-primary" />
            {fileName || "Resume preview"}
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 min-h-0 bg-secondary/30">
          {loading ? (
            <div className="flex items-center justify-center h-full text-muted-foreground gap-2">
              <Loader2 className="w-5 h-5 animate-spin" />
              Loading preview…
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-full text-destructive text-sm px-8 text-center">
              {error}
            </div>
          ) : previewUrl ? (
            <iframe
              title={fileName || "Resume PDF"}
              src={previewUrl}
              className="w-full h-full border-0 bg-white"
            />
          ) : textContent ? (
            <pre className="h-full overflow-auto p-5 text-sm text-foreground whitespace-pre-wrap font-sans subtle-scroll">
              {textContent}
            </pre>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
