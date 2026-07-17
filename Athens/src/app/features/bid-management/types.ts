export type BidResultStatus =
  | "pending"
  | "in_process"
  | "submitted"
  | "reviewed"
  | "rejected"
  | "skipped";

export type FlagLight = "green" | "red" | null;

export type RejectSource = "submitted" | "skipped";

export type BidJobDetail = {
  description: string | null;
  postedAt: string | null;
  postedLabel: string | null;
  salary: string | null;
  workMode: string | null;
  seniority: string | null;
  employmentType: string | null;
  experience: string | null;
  skills: string[];
  applicantsText: string | null;
};

export type BidResumeInfo = {
  name: string;
  techStack: string | null;
  source: string | null;
  fileName: string | null;
  usedAt: string | null;
  scorePercent: number | null;
};

export type BidReviewEvent = {
  id: string;
  taskId: string | null;
  jobId: string | null;
  applierName: string | null;
  eventType: string;
  fromStatus: string | null;
  toStatus: string | null;
  actorType: string;
  actorName: string | null;
  rejectReason: string | null;
  rejectSource: RejectSource | null;
  meta: Record<string, unknown> | null;
  createdAt: string | null;
};

export type BidResult = {
  id: string;
  /** vendor_tasks id (or jobId) used for PATCH /bid-results/:id */
  taskId?: string | null;
  /** Mongo job id when linked to Job Search / Bid ready. */
  jobId: string | null;
  /** Calendar day key YYYY-MM-DD used for folder grouping (pooled date). */
  dayKey: string;
  job: {
    title: string;
    company: string;
    location: string;
    source: string;
    applyUrl: string;
  };
  bidder: {
    name: string;
    avatarInitials: string;
  };
  status: BidResultStatus;
  pooledAt: string;
  submittedAt: string | null;
  durationSec: number | null;
  biddingDurationSec?: number | null;
  matchScore: number | null;
  flags: {
    remote: FlagLight;
    clearance: FlagLight;
  };
  /** Snapshot job fields. Live fetch overlays when jobId is set. */
  jobDetail: BidJobDetail | null;
  /** Recommended / generated résumé for this job (pending & in-process). */
  recommendedResume: BidResumeInfo | null;
  /** Résumé actually used on submission (submitted / reviewed / rejected). */
  submissionResume: BidResumeInfo | null;
  recording: {
    storagePath: string;
    contentType: string;
    sizeBytes: number;
    /** Optional direct URL; live tickets resolve storagePath via signed URL. */
    previewUrl?: string | null;
  } | null;
  notes: string | null;
  rejectReason?: string | null;
  rejectSource?: RejectSource | null;
  rejectCount?: number;
  resubmitCount?: number;
  lastRejectedAt?: string | null;
  lastResubmittedAt?: string | null;
  resumeOriginalName?: string | null;
  resumeExpectedName?: string | null;
  resumeCleanedName?: string | null;
  resumeRenamed?: boolean;
  resumeMismatch?: boolean;
  /** JD page summary from Bid-Monitor Analyze. */
  analysisSummary?: string | null;
  /** Library stack recommended by Bid-Monitor Recommend resume. */
  recommendedResumeStack?: string | null;
  recommendedResumeReason?: string | null;
  useCustomizedResume?: boolean;
  recommendWarning?: string | null;
  recommendedAt?: string | null;
  /** Upload basename vs recommended Library stack. */
  resumeStackMatch?: "match" | "mismatch" | "unknown" | null;
};

export type BidAiUsageRow = {
  id: string;
  feature: string | null;
  provider: string | null;
  requestedModel: string | null;
  billedModel: string | null;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number | null;
  success: boolean;
  durationMs: number | null;
  applierName: string | null;
  jobId: string | null;
  createdAt: string | null;
};

export type BidResultKpis = Record<BidResultStatus, number> & { total: number };

export type BidResultStats = {
  totalTasks: number;
  submitted: number;
  reviewed: number;
  rejected: number;
  skipped: number;
  rejectFromSubmitted: number;
  rejectFromSkipped: number;
  rejectCount: number;
  resubmitCount: number;
  realRejects: number;
  rejectionRate: number;
  realRejectRate: number;
  avgBiddingDurationSec: number | null;
  biddingDurationSamples: number;
  since?: string | null;
  until?: string | null;
};

export type DateFolder = {
  dayKey: string;
  label: string;
  count: number;
  byStatus: Record<BidResultStatus, number>;
};

export type PeriodPreset = "7d" | "14d" | "30d" | "all";

export type ViewMode = "kanban" | "list";

export const BID_STATUSES: BidResultStatus[] = [
  "pending",
  "in_process",
  "submitted",
  "reviewed",
  "rejected",
  "skipped",
];

/** Kanban drag + preview status edit among reviewable statuses. */
export const EDITABLE_STATUSES: BidResultStatus[] = ["submitted", "reviewed", "rejected"];

export function isEditableStatus(status: BidResultStatus): boolean {
  return EDITABLE_STATUSES.includes(status);
}

/** Submitted/reviewed/rejected editable; skipped can only move to rejected. */
export function canChangeStatus(from: BidResultStatus, to: BidResultStatus): boolean {
  if (from === to) return true;
  if (from === "skipped" && to === "rejected") return true;
  if (isEditableStatus(from) && isEditableStatus(to)) return true;
  return false;
}

export function isRejectableStatus(status: BidResultStatus): boolean {
  return status === "submitted" || status === "reviewed" || status === "skipped";
}
