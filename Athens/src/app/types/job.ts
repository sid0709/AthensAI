export type WorkMode = "remote" | "hybrid" | "onsite";

/** Application pipeline status for Job Search & analytics (Athens-server job_market). */
export type JobStatus =
  | "posted"
  | "bid-ready"
  | "bid-completed"
  | "applied"
  | "scheduled"
  | "declined";

export type SkillAnalysisStatus = "pending" | "queued" | "analyzing" | "analyzed" | "failed";

export interface SkillAnalysisUsage {
  model?: string | null;
  inputTokens: number;
  cachedTokens?: number;
  outputTokens: number;
  totalTokens: number;
  cost: number | null;
  savings?: number | null;
}

export interface SkillAnalysis {
  status: SkillAnalysisStatus;
  queuedAt?: string;
  startedAt?: string;
  analyzedAt?: string;
  failedAt?: string;
  error?: string;
  provider?: "deepseek" | string;
  model?: string;
  applierName?: string | null;
  skillsProcessed?: number;
  usage?: SkillAnalysisUsage | null;
}

export interface JobScores {
  overall: number;
  skill: number;
  /** Skills covered vs required (Best Match containment). */
  skillsCovered?: number;
  skillsRequired?: number;
  /** Semantic similarity component when hybrid ranking is active. */
  vector?: number | null;
}

export interface Job {
  id: string;
  /** MongoDB _id when loaded from Athens-server API */
  backendId?: string;
  title: string;
  company: string;
  companyUrl: string;
  logoUrl?: string;
  location: string;
  workMode: WorkMode;
  type: string;
  seniority: string;
  /** Years of experience hint from details.date (e.g. "5+ years exp"). */
  experience?: string;
  industries: string[];
  status: JobStatus;
  scores: JobScores;
  /** @deprecated use scores.overall */
  matchScore: number;
  posted: string;
  postedAt: string;
  /** Human-readable relative time from source (e.g. "2 hours ago"). */
  postedAgo?: string;
  salary: string;
  source: string;
  jobDescription: string;
  skills: string[];
  /** Job-level tags (e.g. "200+ applicants"). */
  tags: string[];
  applicantsText?: string;
  applyUrl: string;
  skillAnalysis?: SkillAnalysis;
  /** Tech stack of the resume that best matched this job (recommendation API). */
  bestResumeTechStack?: string;
  /** Per-skill match flags for UI (from list-time Best Match scoring). */
  skillHighlights?: { name: string; matched: boolean }[];
  /** AI-detected skills with category + requirement (1-5), when analyzed. */
  aiSkills?: { name: string; category: string; requirement: number }[];
  /** AI title-role classification (Software Engineer, DevOps, …). */
  titleScanned?: string | null;
  /** Ingest provenance — "v2" = extension-v2 (beta-only). */
  version?: string | null;
  /** Data catalog: job_market (default) or external_scraped_jobs. */
  catalog?: "market" | "external";
}

export function isExternalJob(job: Pick<Job, "catalog">): boolean {
  return job.catalog === "external";
}
