import type { BackgroundTask } from "@/app/api/backgroundTasks";
import type { SkillExtractSession } from "@/app/api/jobSkillExtract";

export function skillExtractionSessionFromTask(
  task: BackgroundTask | null,
): SkillExtractSession | null {
  if (!task) return null;
  const progress = task.progress || {};
  const status: SkillExtractSession["status"] = task.status === "cancelling"
    ? "stopping"
    : task.status === "completed_with_errors"
      ? "completed"
      : task.status;

  return {
    running: ["queued", "running", "cancelling"].includes(task.status),
    status,
    sessionId: task.id,
    pending: null,
    pendingKnown: false,
    total: progress.total as number | null | undefined,
    processed: Number(progress.completed ?? 0),
    extracted: Number(progress.extracted ?? 0),
    failed: Number(progress.failed ?? 0),
    retried: Number(progress.retried ?? 0),
    cancelled: Number(progress.cancelled ?? 0),
    remaining: progress.remaining as number | null | undefined,
    phase: progress.phase as SkillExtractSession["phase"],
    inflight: Number(progress.active ?? 0),
    lastProgressAt: task.updatedAt,
    lastJob: progress.lastJob as SkillExtractSession["lastJob"],
    queuedAt: task.createdAt,
    startedAt: task.startedAt || undefined,
    finishedAt: task.finishedAt,
    error: task.error,
    concurrency: 8,
    batchSize: 8,
    jobsPerWave: 64,
  };
}
