import type {
  BidResult,
  BidResultKpis,
  BidResultStatus,
  DateFolder,
  PeriodPreset,
} from "./types";
import { BID_STATUSES } from "./types";

export const STATUS_LABELS: Record<BidResultStatus, string> = {
  pending: "Pending",
  in_process: "In-Process",
  submitted: "Submitted",
  reviewed: "Reviewed",
  rejected: "Rejected",
  skipped: "Skipped",
};

export const PERIOD_LABELS: Record<PeriodPreset, string> = {
  "7d": "Last 7 days",
  "14d": "Last 14 days",
  "30d": "Last 30 days",
  all: "All time",
};

function dayKeyFromDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function dayKeyFromIso(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return dayKeyFromDate(new Date());
  return dayKeyFromDate(d);
}

function initials(name: string | null | undefined): string {
  const parts = String(name || "?").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

/** Map a live vendor / bid-results task into a BidResult. */
export function vendorTaskToBidResult(task: {
  id: string;
  jobId?: string | null;
  applierName: string | null;
  bidderName?: string | null;
  title: string;
  company: string | { name?: string; tags?: string[]; logo?: string };
  applyUrl: string | null;
  source: string;
  location: string;
  matchScore: number | null;
  progress: string;
  status?: string;
  bidderInProcess?: boolean;
  addedAt: string | null;
  bidReadyDate?: string | null;
  completedAt?: string | null;
  reviewStatus?: string | null;
  recording?: {
    storagePath: string;
    contentType?: string | null;
    sizeBytes?: number;
  } | null;
  recordingDurationSec?: number | null;
}): BidResult {
  const pooledAt = task.bidReadyDate || task.addedAt || new Date().toISOString();
  const bidderName = task.bidderName || task.applierName || "Unassigned";
  // Prefer reviewStatus over skipped (rejected-from-skip must show Rejected).
  let status: BidResult["status"] = "pending";
  if (
    task.reviewStatus === "reviewed" ||
    task.reviewStatus === "rejected" ||
    task.reviewStatus === "submitted"
  ) {
    status = task.reviewStatus;
  } else if (task.progress === "skipped" || task.status === "skipped") {
    status = "skipped";
  } else if (task.progress === "completed" || task.status === "done") {
    status = "submitted";
  } else if (task.bidderInProcess) {
    status = "in_process";
  }

  const company =
    typeof task.company === "string"
      ? task.company.trim() || "Unknown"
      : String(task.company?.name || "").trim() || "Unknown";

  return {
    id: `bid-${task.id}`,
    taskId: task.id,
    jobId: task.jobId || null,
    dayKey: dayKeyFromIso(pooledAt),
    job: {
      title: task.title,
      company,
      location: task.location || "—",
      source: task.source || "—",
      applyUrl: task.applyUrl || "#",
    },
    bidder: {
      name: bidderName,
      avatarInitials: initials(bidderName),
    },
    status,
    pooledAt,
    submittedAt: status === "skipped" ? null : task.completedAt || null,
    durationSec: task.recordingDurationSec ?? null,
    matchScore: task.matchScore,
    flags: { remote: null, clearance: null },
    jobDetail: null,
    recommendedResume: null,
    submissionResume: null,
    recording: task.recording?.storagePath
      ? {
          storagePath: task.recording.storagePath,
          contentType: task.recording.contentType || "video/webm",
          sizeBytes: Number(task.recording.sizeBytes || 0),
          previewUrl: null,
        }
      : null,
    notes:
      status === "pending"
        ? "Bid ready — waiting for bidder"
        : status === "in_process"
          ? "Bid in progress"
          : status === "skipped"
            ? "Skipped by bidder"
            : null,
  };
}

export function computeKpis(results: BidResult[]): BidResultKpis {
  const base: BidResultKpis = {
    pending: 0,
    in_process: 0,
    submitted: 0,
    reviewed: 0,
    rejected: 0,
    skipped: 0,
    total: results.length,
  };
  for (const r of results) base[r.status] += 1;
  return base;
}

export function periodStartMs(preset: PeriodPreset): number | null {
  if (preset === "all") return null;
  const days = preset === "7d" ? 7 : preset === "14d" ? 14 : 30;
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (days - 1));
  return d.getTime();
}

export function filterByPeriod(results: BidResult[], preset: PeriodPreset): BidResult[] {
  const start = periodStartMs(preset);
  if (start == null) return results;
  return results.filter((r) => new Date(r.pooledAt).getTime() >= start);
}

export function buildDateFolders(results: BidResult[]): DateFolder[] {
  const map = new Map<string, BidResult[]>();
  for (const r of results) {
    const list = map.get(r.dayKey) ?? [];
    list.push(r);
    map.set(r.dayKey, list);
  }
  return Array.from(map.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([dayKey, items]) => {
      const byStatus = Object.fromEntries(BID_STATUSES.map((s) => [s, 0])) as Record<
        BidResultStatus,
        number
      >;
      for (const item of items) byStatus[item.status] += 1;
      const d = new Date(`${dayKey}T12:00:00`);
      const label = Number.isNaN(d.getTime())
        ? dayKey
        : d.toLocaleDateString(undefined, {
            weekday: "short",
            month: "short",
            day: "numeric",
            year: "numeric",
          });
      return { dayKey, label, count: items.length, byStatus };
    });
}

export function formatDuration(sec: number | null): string {
  if (sec == null) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatFolderShort(dayKey: string): string {
  const d = new Date(`${dayKey}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dayKey;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
