/** Title Review list tabs / queue states (derived from `temp_jobs`, not a membership table). */
export const TITLE_REVIEW_META_STATES = {
  PENDING: 'pending',
  REVIEW_REQUIRED: 'review_required',
  FAILED: 'failed',
} as const;

export type TitleReviewMetaState =
  (typeof TITLE_REVIEW_META_STATES)[keyof typeof TITLE_REVIEW_META_STATES];

/** Flat Job / TempJob.titleReviewLabel values. */
export const JOB_TITLE_REVIEW_LABELS = {
  APPROVED: 'APPROVED',
  PENDING: 'PENDING',
  REVIEW_REQUIRED: 'REVIEW_REQUIRED',
} as const;

/** Job.aiSkillStatus values that still need extraction (on APPROVED titles). */
export const JOB_SKILL_EXTRACT_OPEN_STATUSES = ['pending', 'failed'] as const;
