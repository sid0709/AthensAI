import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Clock, Loader2, RefreshCw } from "lucide-react";
import { cn } from "../../../lib/utils";
import {
  fetchApplyRun,
  fetchApplyRuns,
  type ApplyLogEvent,
  type ApplyRunDetail,
  type ApplyRunSummary,
} from "../../../api/avalonLog";

/**
 * Right-docked, collapsible run history. Every apply run (auto-run or manual
 * per-job apply) is persisted server-side via startRunLog/endRunLog
 * (useAvalonRelay.ts); this panel just lists + expands them. Polls while open so
 * a run-in-progress updates live without a manual refresh.
 */

const POLL_MS = 5000;

type StatusTone = "running" | "success" | "warn" | "neutral" | "error";

function statusMeta(status?: string | null): { label: string; tone: StatusTone } {
  const s = (status ?? "").toLowerCase();
  if (s === "running") return { label: "Running", tone: "running" };
  if (s === "applied" || s === "applied-recovered") return { label: "Applied", tone: "success" };
  if (s === "unconfirmed") return { label: "Unconfirmed", tone: "warn" };
  if (s === "stopped") return { label: "Stopped", tone: "neutral" };
  if (s === "error" || s === "failed") return { label: "Error", tone: "error" };
  if (s === "budget-exceeded") return { label: "Budget skip", tone: "warn" };
  if (s.startsWith("skipped-")) return { label: `Skipped (${s.slice(8)})`, tone: "neutral" };
  if (!s) return { label: "Unknown", tone: "neutral" };
  return { label: s, tone: "neutral" };
}

const TONE_CLASS: Record<StatusTone, string> = {
  running: "text-blue-700 bg-blue-500/10",
  success: "text-emerald-700 bg-emerald-500/10",
  warn: "text-amber-700 bg-amber-500/10",
  neutral: "text-muted-foreground bg-secondary",
  error: "text-red-700 bg-red-500/10",
};

function StatusBadge({ status }: { status?: string | null }) {
  const meta = statusMeta(status);
  return (
    <span className={cn("inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0", TONE_CLASS[meta.tone])}>
      {meta.tone === "running" && <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-pulse" />}
      {meta.label}
    </span>
  );
}

/** "3m ago" for recent runs, else a locale time/date. */
function timeAgo(iso?: string | null): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const diffMs = Date.now() - t;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString();
}

function EventRow({ event }: { event: ApplyLogEvent }) {
  return (
    <div
      className={cn(
        "text-[10px] font-mono leading-relaxed px-2 py-1.5 rounded-lg border border-transparent",
        event.level === "success" && "bg-emerald-500/8 text-emerald-800 border-emerald-500/15",
        event.level === "error" && "bg-red-500/8 text-red-800 border-red-500/15",
        event.level === "warn" && "bg-amber-500/8 text-amber-800 border-amber-500/15",
        event.level === "info" && "text-foreground/80",
      )}
    >
      <span className="text-muted-foreground">{new Date(event.at).toLocaleTimeString()}</span>{" "}
      {event.phase && <span className="text-violet-600 font-semibold">[{event.phase}] </span>}
      {event.message}
    </div>
  );
}

function RunEntry({ run }: { run: ApplyRunSummary }) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<ApplyRunDetail | null>(null);
  const [loading, setLoading] = useState(false);

  const toggle = useCallback(async () => {
    setExpanded((v) => !v);
    if (!detail && !loading) {
      setLoading(true);
      const full = await fetchApplyRun(run.runId);
      setDetail(full);
      setLoading(false);
    }
  }, [detail, loading, run.runId]);

  const sessionId = typeof run.meta?.sessionId === "string" ? run.meta.sessionId : "";

  return (
    <div className="rounded-xl border border-border/60 overflow-hidden">
      <button type="button" onClick={() => void toggle()} className="w-full text-left px-3 py-2.5 hover:bg-secondary/40 transition-colors">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-foreground truncate">{run.job?.title || "(untitled)"}</p>
            <p className="text-[10px] text-muted-foreground truncate mt-0.5">
              {run.job?.company || run.job?.source || "—"}
              {sessionId && <span className="ml-1.5 text-muted-foreground/70">· session {sessionId.slice(0, 8)}</span>}
            </p>
          </div>
          <StatusBadge status={run.status} />
        </div>
        <p className="text-[9px] text-muted-foreground mt-1.5">{timeAgo(run.startedAt)}</p>
      </button>
      {expanded && (
        <div className="border-t border-border/50 bg-secondary/10 p-2 space-y-1 max-h-[280px] overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-4 text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            </div>
          )}
          {!loading && (!detail?.events || detail.events.length === 0) && (
            <p className="text-[10px] text-muted-foreground text-center py-3">No event details recorded</p>
          )}
          {!loading && detail?.events?.map((event, i) => <EventRow key={i} event={event} />)}
        </div>
      )}
    </div>
  );
}

export interface RunHistorySessionOption {
  id: string;
  name: string;
  /** Avalon relay session id this tab is bound to — the actual filter key (empty = shared default). */
  sessionId: string;
}

export function RunHistoryPanel({
  applierName,
  sessions,
}: {
  applierName: string;
  /** Tabbed sessions, for the per-session/all filter (Phase 3). Omit for a single-session view. */
  sessions?: RunHistorySessionOption[];
}) {
  const [open, setOpen] = useState(false);
  const [runs, setRuns] = useState<ApplyRunSummary[]>([]);
  const [loading, setLoading] = useState(false);
  // Keyed by tab id (not Avalon sessionId — two tabs can share a blank/default one,
  // which would make a native <select> ambiguous by value).
  const [filterTabId, setFilterTabId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    if (!applierName) return;
    setLoading(true);
    const list = await fetchApplyRuns(applierName, 50);
    setRuns(list);
    setLoading(false);
  }, [applierName]);

  useEffect(() => {
    if (!open) return;
    void load();
    pollRef.current = setInterval(() => void load(), POLL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [open, load]);

  const filterSessionId = filterTabId != null ? (sessions?.find((s) => s.id === filterTabId)?.sessionId ?? "") : null;
  const filteredRuns =
    filterSessionId != null
      ? runs.filter((r) => (typeof r.meta?.sessionId === "string" ? r.meta.sessionId : "") === filterSessionId)
      : runs;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="shrink-0 w-9 self-start h-[440px] flex flex-col items-center justify-center gap-2 rounded-2xl border border-border/80 bg-card shadow-sm hover:bg-secondary/40 transition-colors"
        title="Show run history"
      >
        <ChevronLeft className="w-3.5 h-3.5 text-muted-foreground" />
        <Clock className="w-4 h-4 text-muted-foreground" />
        <span className="text-[10px] font-bold text-muted-foreground [writing-mode:vertical-rl]">History</span>
      </button>
    );
  }

  return (
    <div className="shrink-0 self-start w-80 h-[440px] flex flex-col rounded-2xl border border-border/80 bg-card shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-border/60 flex items-center justify-between gap-2 bg-gradient-to-r from-violet-500/5 to-transparent">
        <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
          <Clock className="w-4 h-4 text-violet-600" />
          History
        </h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="p-1.5 rounded-lg border border-border hover:bg-secondary disabled:opacity-40"
            title="Refresh"
          >
            <RefreshCw className={cn("w-3.5 h-3.5 text-muted-foreground", loading && "animate-spin")} />
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="p-1.5 rounded-lg border border-border hover:bg-secondary"
            title="Collapse"
          >
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </div>
      </div>
      {sessions && sessions.length > 1 && (
        <div className="px-3 py-2 border-b border-border/60">
          <select
            value={filterTabId ?? ""}
            onChange={(e) => setFilterTabId(e.target.value === "" ? null : e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-[11px] focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">All sessions</option>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-y-auto subtle-scroll p-2 space-y-1.5">
        {loading && runs.length === 0 && (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        )}
        {!loading && filteredRuns.length === 0 && (
          <p className="text-[11px] text-muted-foreground text-center py-10">No runs yet</p>
        )}
        {filteredRuns.map((run) => (
          <RunEntry key={run.runId} run={run} />
        ))}
      </div>
    </div>
  );
}
