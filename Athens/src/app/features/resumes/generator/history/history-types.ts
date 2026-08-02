import type {
  GeneratedContent,
  Identity,
  LayoutSection,
  ResumeCoverageAnalysis,
  ResumeCoverageAudit,
  ResumeTheme,
  UsageBreakdown,
} from "../types";

export type RunSummary = {
  _id: unknown;
  status?: string;
  provider?: string;
  model?: string;
  jobDescription?: string;
  techStack?: string;
  usage?: UsageBreakdown | null;
  startedAt?: string;
  finishedAt?: string;
  config?: { templateId?: string };
  sections?: Record<string, unknown>;
  error?: string;
  coverageAudit?: ResumeCoverageAudit | null;
};

export type FullRun = RunSummary & {
  sections?: Record<string, unknown>;
  identity?: Identity | null;
  config?: Record<string, unknown>;
  skillProfile?: { name: string; category?: string; level?: number; strength?: number }[];
  techStack?: string;
  analyzed?: boolean;
  analyzedAt?: string;
  skillAnalysisError?: string | null;
  coverageAnalysis?: ResumeCoverageAnalysis | null;
  coverageContract?: Record<string, unknown> | null;
};

export type HistoryFacets = {
  models: string[];
  providers: string[];
  templates: string[];
  statusCounts: { completed: number; failed: number };
  stats: { completed: number; totalTokens: number; totalCost: number };
};

export type HistorySearchIn = "all" | "jd" | "resume";
export type HistoryStatus = "all" | "completed" | "failed";
export type HistorySort = "newest" | "oldest" | "cost-desc" | "cost-asc" | "tokens-desc";
