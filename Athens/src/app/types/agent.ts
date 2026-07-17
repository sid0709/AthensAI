/**
 * Per-job outcome inside an agent run.
 */
export type AgentJobStatus = "in_progress" | "succeeded" | "failed" | "scheduled" | "review";

export interface RunSummary {
  id: string;
  agentName: string;
  profileId: string;
  profileName: string;
  model: string;
  source: string;
  jobCount: number;
  status: string;
  result: string | null;
  startedAt: number;
  finishedAt: number | null;
  submitted: number;
  url: string;
}

export interface JobRow {
  id: string;
  title: string;
  company: string;
  source: string;
  url: string;
  postedAgo: string;
  appliedDate: string | null;
  status: AgentJobStatus;
  agentName?: string | null;
  matchPercent?: number | null;
  resumeStack?: string | null;
}

export interface ActivityEntry {
  id: string;
  ts: string;
  time: string;
  agentName: string;
  profile?: string;
  event: string;
  type: "info" | "success" | "warn" | "error";
  status?: string;
}

export interface DashboardData {
  posted: number;
  appliedToday: number;
  applied7d: number;
  scheduled: number;
  activeRuns: number;
  totalRuns: number;
  inFlightJobs: number;
  succeededToday: number;
  bySource: Record<string, number>;
  runPipeline: {
    inProgress: number;
    succeeded: number;
    failed: number;
    review: number;
    scheduled: number;
  };
  pipelineStages: {
    posted: number;
    scheduled: number;
    inRun: number;
    submitted: number;
    reviewPending: number;
    error: number;
  };
  applications7d: { day: string; date: string; count: number }[];
  submissions7d: { day: string; date: string; count: number }[];
  byStatus: Record<string, number>;
  jobs: JobRow[];
}

export interface HealthData {
  ok: boolean;
  model?: string;
  keyPresent?: boolean;
  mongoDb?: string;
}

export interface AvalonHealthData {
  ok: boolean;
  extension: boolean;
  sessionId?: string;
}

export interface LogEntry {
  id: string;
  time: string;
  agentName: string;
  event: string;
  type: "info" | "success" | "warn" | "error";
}

export interface ActiveRun {
  runId: string;
  agentName: string;
  url: string;
  profileName?: string;
  model?: string;
  source?: string;
  jobCount?: number;
  mode: "live" | "review";
}

/** Agent dashboard job table tabs (subset of AgentJobStatus). */
export type AgentJobTabKey = "in_progress" | "succeeded" | "failed" | "scheduled";

export interface DeployOptions {
  name: string;
  profileId: string;
  model: string;
  source: string;
  jobIds?: string[];
  jobs?: Array<{ id: string; title: string; company: string; url: string; source: string }>;
  /** When set, deploy creates a brand-new tabbed session instead of queuing into the active one. */
  createNewSession?: boolean;
  /** Avalon relay session id the new session's extension must match (createNewSession only). */
  avalonSessionId?: string;
}

export interface ModelOption {
  id: string;
}

export interface SourceOption {
  title: string;
  type: string;
  posted: number;
}

export interface RunStep {
  seq: number;
  level: string;
  title: string;
  detail?: string;
}

export interface RunField {
  label: string;
  value: string;
  source: string;
}

export interface RunUsage {
  model?: string;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  costLabel?: string;
}

export interface RunMeta {
  role?: string;
  company?: string;
  profileName?: string;
  model?: string;
  resumeStack?: string;
}

export interface RunDone {
  result: string;
  message: string;
  usage?: RunUsage;
  submitted?: number;
  total?: number;
}

export interface RunJob {
  index: number;
  total: number;
  title: string;
  company: string;
}

export interface RunBatch {
  total: number;
  source: string;
}

export interface ResumeMatch {
  jobTitle?: string;
  jobCompany?: string;
  jobDescription?: string;
  jobSkills?: string[];
  skillProfile?: string;
  analysisError?: string | null;
  bestResume?: { name: string; scorePercent: number };
  topResumes?: { name: string; scorePercent: number }[];
  resumeStack?: string;
  aiGenerated?: boolean;
  generationId?: string | null;
  resumeId?: string | null;
  profileName?: string | null;
  resumeFileName?: string | null;
  resumeMimeType?: string | null;
  resumeSizeBytes?: number | null;
  submittedFileName?: string | null;
  hasRunResume?: boolean;
}

export interface Screenshot {
  label: string;
  dataUrl: string;
}

export interface JobView {
  index: number;
  title: string;
  company: string;
  steps: RunStep[];
  fields: RunField[];
  shot: Screenshot | null;
  status: string;
  meta: RunMeta;
  resumeMatch: ResumeMatch | null;
  result?: string;
  usage?: RunUsage | null;
}
