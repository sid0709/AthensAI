import React, { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { downloadMongoBackupZip } from "@/app/api/mongoBackup";

/**
 * Admin-only control: download a zip of every MongoDB collection as JSON.
 */
export function MongoBackupCard({ applierName }: { applierName: string }) {
  const [downloading, setDownloading] = useState(false);

  const download = async () => {
    setDownloading(true);
    try {
      await downloadMongoBackupZip(applierName);
      toast.success("MongoDB backup downloaded");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Backup download failed");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="mb-4 rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-foreground">Database backup</h3>
          <p className="mt-1 text-sm text-muted-foreground max-w-xl">
            Download a full AthensDB export as a zip of JSON files — one file per collection,
            including all documents.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void download()}
          disabled={downloading}
          className="inline-flex items-center gap-2 border border-border bg-secondary text-foreground px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-muted min-h-10 disabled:opacity-50 shrink-0"
        >
          {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          {downloading ? "Building backup…" : "Download MongoDB backup"}
        </button>
      </div>
    </div>
  );
}
