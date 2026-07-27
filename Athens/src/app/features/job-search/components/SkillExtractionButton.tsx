import React from "react";
import { Loader2, Sparkles, Square } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { useJobSkillExtraction } from "../hooks/useJobSkillExtraction";

/**
 * Self-contained toolbar control to run AI skill extraction over jobs pending
 * extraction, with immediate Stop and live progress.
 */
export function SkillExtractionButton() {
  const { session, pending, loading, isRunning, start, stop } = useJobSkillExtraction();

  if (isRunning) {
    const total = session.total ?? null;
    const processed = session.processed ?? 0;
    const inflight = session.inflight ?? 0;
    const pct = total ? Math.min(100, Math.round((processed / total) * 100)) : null;
    const progressLabel = session.status === "stopping"
      ? "Stopping…"
      : processed === 0 && inflight > 0
        ? "Analyzing first batch…"
        : session.phase === "recovering"
          ? "Recovering interrupted work…"
        : session.phase === "claiming"
          ? "Loading next batch…"
          : "Extracting…";
    return (
      <div className="flex items-center gap-2 shrink-0">
        <div className="flex flex-col gap-0.5 min-w-[150px]">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>{progressLabel}</span>
            <span className="font-mono tabular-nums">
              {total ? `${processed}/${total}` : `${processed} done`}
            </span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
            <div
              className={`h-full bg-violet-600 transition-all ${pct == null ? "w-1/3 animate-pulse" : ""}`}
              style={pct == null ? undefined : { width: `${pct}%` }}
            />
          </div>
          {inflight > 0 && (
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {inflight} jobs active
              {session.concurrency && session.batchSize
                ? ` · ${session.concurrency} batches × ${session.batchSize}`
                : ""}
            </span>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-1.5"
          disabled={loading || session.status === "stopping"}
          onClick={() => void stop()}
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Square className="w-3.5 h-3.5" />}
          Stop
        </Button>
      </div>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      className="h-9 gap-1.5 shrink-0"
      disabled={loading || pending === 0}
      onClick={() => void start()}
      title={pending === 0 ? "All jobs have AI skills" : pending == null ? "Extract missing job skills with AI" : `${pending} job(s) pending`}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
      Extract skills
      {pending != null && (
        <span
          className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full text-[10px] font-bold tabular-nums ${
            pending === 0
              ? "bg-muted text-muted-foreground"
              : "bg-violet-600 text-white"
          }`}
          aria-label={`${pending} jobs pending skill extraction`}
        >
          {pending.toLocaleString()}
        </span>
      )}
    </Button>
  );
}
