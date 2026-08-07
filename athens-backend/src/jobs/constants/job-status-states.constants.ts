/** Per-job application states stored on `job_statuses.state`. */
export const JOB_STATUS_STATES = [
  'posted',
  'bid-ready',
  'bid-completed',
  'applied',
  'scheduled',
  'declined',
] as const;

export type JobStatusState = (typeof JOB_STATUS_STATES)[number];
