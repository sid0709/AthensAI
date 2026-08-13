export type WorkMode = "remote" | "hybrid" | "onsite";

/** Application pipeline status for Job Search & analytics (Athens-server job_market). */
export type JobStatus =
  | "posted"
  | "bid-ready"
  | "worker-pool"
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

export interface Job {
  id: string;
  /** Firestore _id when loaded from Athens-server API */
  backendId?: string;
	/** Stable canonical employer identity used by grouped Job Search. */
	companyId: string;
  title: string;
  company: string;
  companyUrl: string;
  logoUrl?: string;
  location: string;
  workMode: WorkMode;
  type: string;
  seniority: string;
  /** Optional experience hint when present on a row (no longer sourced from metadata.details). */
  experience?: string;
  industries: string[];
  status: JobStatus;
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
  /** AI-detected skills with category + requirement (1-5), when analyzed. */
  aiSkills?: { name: string; category: string; requirement: number }[];
  /** Total detected skills when list responses include only the top chips. */
  skillCount?: number;
  /** Ingest provenance — "v2" = extension-v2 (beta-only). */
  version?: string | null;
  /** Data catalog: job_market (default) or external_scraped_jobs. */
  catalog?: "market" | "external";
  /** Library stack recommended for Bid ready or Worker pool (vendor_tasks). */
  recommendedResumeStack?: string | null;
  /** Library Resume.id when a specific file was chosen. */
  recommendedResumeId?: string | null;
  recommendedResumeReason?: string | null;
  useCustomizedResume?: boolean;
  recommendWarning?: string | null;
  recommendedAt?: string | null;
  /** llm | heuristic | manual */
  recommendMode?: "llm" | "heuristic" | "manual" | null;
}

export interface CompanyJobGroup {
	companyId: string;
	company: {
		name: string;
		logoUrl?: string;
		url?: string;
	};
	jobs: Job[];
	/** Total roles matching the current grouped Job Search request. */
	matchingJobCount?: number;
	/** Matching job ids for this company (may be longer than hydrated `jobs`). */
	matchingJobIds?: string[];
	nextMemberOffset?: number | null;
	/** Client-side ordering for partially loaded member batches and deep-linked roles. */
	memberOrder?: Record<string, number>;
}

export function isExternalJob(job: Pick<Job, "catalog">): boolean {
  return job.catalog === "external";
}
