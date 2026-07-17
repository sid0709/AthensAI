// The reference token users can drop into any prompt; replaced with the actual
// job-description text at generation time.
export const JOB_DESC_TOKEN = "{job_description}";
export const TOKEN_RE = /\{[a-z0-9_]+\}/gi;
