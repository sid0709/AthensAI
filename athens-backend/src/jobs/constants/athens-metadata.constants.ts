/** Shared catalog queues in `athens_metadata` (not per-profile). */
export const ATHENS_METADATA_QUEUES = {
  TITLE_REVIEW: 'title_review',
  SKILL_EXTRACT: 'skill_extract',
} as const;

export type AthensMetadataQueue =
  (typeof ATHENS_METADATA_QUEUES)[keyof typeof ATHENS_METADATA_QUEUES];

export const TITLE_REVIEW_META_STATES = {
  PENDING: 'pending',
  REVIEW_REQUIRED: 'review_required',
  FAILED: 'failed',
} as const;

export type TitleReviewMetaState =
  (typeof TITLE_REVIEW_META_STATES)[keyof typeof TITLE_REVIEW_META_STATES];

export const SKILL_EXTRACT_META_STATES = {
  PENDING: 'pending',
  FAILED: 'failed',
} as const;

export type SkillExtractMetaState =
  (typeof SKILL_EXTRACT_META_STATES)[keyof typeof SKILL_EXTRACT_META_STATES];

/** Flat Job.titleReviewLabel values that feed the title-review queue. */
export const JOB_TITLE_REVIEW_LABELS = {
  APPROVED: 'APPROVED',
  PENDING: 'PENDING',
  REVIEW_REQUIRED: 'REVIEW_REQUIRED',
} as const;

/** Job.aiSkillStatus values that still need extraction (on APPROVED titles). */
export const JOB_SKILL_EXTRACT_OPEN_STATUSES = ['pending', 'failed'] as const;
