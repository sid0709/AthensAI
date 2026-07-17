import { useEffect, useMemo } from "react";
import { API_BASE } from "@/lib/api-base";

/** Build URL to stream the on-disk agent draft PDF from the Node backend. */
export function agentJobResumePdfUrl(applierName: string, jobId: string): string {
  const base = API_BASE.replace(/\/$/, "");
  const params = new URLSearchParams({ applierName });
  return `${base}/personal/agent-job-resume/${encodeURIComponent(jobId)}/pdf?${params}`;
}

type Props = {
  applierName?: string;
  jobId?: string;
  base64?: string;
  mimeType?: string;
  className?: string;
};

/**
 * Inline PDF preview for the Agent controller — prefers a blob URL from base64,
 * otherwise streams from the backend draft file (Node fs).
 */
export function AgentResumePdfPreview({ applierName, jobId, base64, mimeType, className }: Props) {
  const blobUrl = useMemo(() => {
    if (!base64) return null;
    try {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return URL.createObjectURL(new Blob([bytes], { type: mimeType || "application/pdf" }));
    } catch {
      return null;
    }
  }, [base64, mimeType]);

  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [blobUrl]);

  const streamUrl =
    !blobUrl && applierName && jobId ? agentJobResumePdfUrl(applierName, jobId) : null;
  const src = blobUrl || streamUrl;

  if (!src) {
    return (
      <div className={`flex items-center justify-center p-6 text-[11px] text-muted-foreground ${className ?? ""}`}>
        Preview unavailable — generate résumé first.
      </div>
    );
  }

  return (
    <iframe
      src={src}
      title="Tailored résumé preview"
      className={className ?? "w-full h-[240px] bg-secondary/20 border-0"}
    />
  );
}
