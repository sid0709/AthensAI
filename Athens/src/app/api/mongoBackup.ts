import { API_BASE } from "@/lib/api-base";

/**
 * Download a full AthensDB backup zip (admin only).
 * Streams the response to a local file download.
 */
export async function downloadMongoBackupZip(requesterName: string): Promise<void> {
  const name = String(requesterName || "").trim();
  if (!name) {
    throw new Error("Admin authentication required");
  }

  const res = await fetch(`${API_BASE.replace(/\/$/, "")}/admin/backup/mongodb.zip`, {
    headers: { "x-applier-name": name },
  });

  if (!res.ok) {
    let message = `Backup failed (${res.status})`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data?.error) message = data.error;
    } catch {
      // non-JSON error body
    }
    throw new Error(message);
  }

  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") || "";
  const match = /filename="([^"]+)"/i.exec(disposition);
  const fileName = match?.[1] || `AthensDB-backup-${Date.now()}.zip`;

  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}
