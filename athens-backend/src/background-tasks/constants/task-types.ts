export const BACKGROUND_TASK_TYPES = {
  MAIL_AI_LABEL: 'mail_ai_label',
  RESUME_GENERATION: 'resume_generation',
} as const;

export type BackgroundTaskType =
  (typeof BACKGROUND_TASK_TYPES)[keyof typeof BACKGROUND_TASK_TYPES];

export const BACKGROUND_TASK_STATUSES = {
  QUEUED: 'queued',
  RUNNING: 'running',
  CANCELLING: 'cancelling',
  CANCELLED: 'cancelled',
  COMPLETED: 'completed',
  COMPLETED_WITH_ERRORS: 'completed_with_errors',
  FAILED: 'failed',
} as const;

export type BackgroundTaskStatus =
  (typeof BACKGROUND_TASK_STATUSES)[keyof typeof BACKGROUND_TASK_STATUSES];

export const MAIL_AI_LABEL_MAX_IDS = 50;

export const WORKER_HEARTBEAT_MS = 5_000;
export const WORKER_LEASE_MS = 60_000;
export const SSE_POLL_MS = 1_000;
export const SSE_HEARTBEAT_MS = 15_000;
