/** Canonical values stored on job_market.titleScanned after AI title analysis. */
export const JOB_TITLE_SCAN_ROLES = [
  "Software Engineer",
  "DevOps",
  "Data Engineer",
  "AI engineer",
  "Healthcare Engineer",
  "Others",
] as const;

export type JobTitleScanRole = (typeof JOB_TITLE_SCAN_ROLES)[number];

export const JOB_TITLE_SCAN_ROLE_OPTIONS = JOB_TITLE_SCAN_ROLES.map((role) => ({
  value: role,
  label: role,
}));
