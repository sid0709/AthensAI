import {
  fileToBase64,
  uploadUserResume,
} from "../../../services/resumeApi";
import type { UserResumeSummary } from "../../../types/resume";

/** Parallel client uploads — avoids one giant base64 body and enables progress. */
export const RESUME_BULK_UPLOAD_CONCURRENCY = 8;

export type BulkUploadItem = {
  file: File;
  techStack: string;
};

export type BulkUploadProgress = {
  current: number;
  total: number;
  failed: { fileName: string; error: string }[];
};

export type BulkUploadResult = {
  ok: UserResumeSummary[];
  failed: { fileName: string; error: string }[];
};

/**
 * Encode + POST each resume with bounded concurrency.
 * Calls `onProgress` after every file settles (success or failure).
 */
export async function uploadResumesInParallel(input: {
  ownerName: string;
  ownerId: string;
  items: BulkUploadItem[];
  concurrency?: number;
  onProgress?: (progress: BulkUploadProgress) => void;
}): Promise<BulkUploadResult> {
  const items = input.items;
  const total = items.length;
  const concurrency = Math.max(
    1,
    Math.min(input.concurrency ?? RESUME_BULK_UPLOAD_CONCURRENCY, total || 1),
  );
  const ok: UserResumeSummary[] = [];
  const failed: { fileName: string; error: string }[] = [];
  let settled = 0;
  let next = 0;

  const report = () => {
    input.onProgress?.({
      current: settled,
      total,
      failed: [...failed],
    });
  };

  report();

  async function worker() {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      const item = items[index];
      const fileName = item.file.name;
      try {
        const contentBase64 = await fileToBase64(item.file);
        const resume = await uploadUserResume({
          ownerName: input.ownerName,
          ownerId: input.ownerId,
          techStack: item.techStack,
          fileName,
          mimeType: item.file.type || "application/octet-stream",
          contentBase64,
        });
        ok.push(resume);
      } catch (err) {
        failed.push({
          fileName,
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        settled += 1;
        report();
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, total || 1) }, () => worker()),
  );

  return { ok, failed };
}
