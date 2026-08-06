import React from "react";
import { AlertCircle, Loader2, Sparkles, Square } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { useJobSkillExtraction } from "../hooks/useJobSkillExtraction";

/**
 * Self-contained toolbar control to run AI skill extraction over jobs pending
 * extraction, with immediate Stop and live progress.
 */
export function SkillExtractionButton() {
  const { session, pending, loading, isRunning, start, stop } = useJobSkillExtraction();

  if (isRunning) {
    const queued = session.status === "queued";
    const total = session.total ?? pending ?? null;
    const processed = session.processed ?? 0;
    const inflight = session.inflight ?? 0;
    const pct = !queued && total ? Math.min(100, Math.round((processed / total) * 100)) : null;
    const progressLabel = session.status === "stopping"
      ? "Stopping…"
      : queued
        ? "Queued…"
      : processed === 0 && inflight > 0
        ? "Analyzing first batch…"
        : session.phase === "recovering"
          ? "Recovering interrupted work…"
        : session.phase === "claiming"
          ? "Loading next batch…"
          : "Extracting…";
    return (
      <div className="flex items-center gap-2 shrink-0" aria-live="polite">
        <div className="flex flex-col gap-0.5 min-w-[190px]">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>{progressLabel}</span>
            <span className="font-mono tabular-nums">
              {total != null ? `${processed}/${total}` : `${processed} done`}
            </span>
          </div>
          <div
            className="h-1.5 w-full rounded-full bg-secondary overflow-hidden"
            role="progressbar"
            aria-label={progressLabel}
            aria-valuemin={0}
            aria-valuemax={total ?? undefined}
            aria-valuenow={pct == null ? undefined : processed}
          >
            <div
              className={`h-full bg-violet-600 transition-all ${pct == null ? "w-1/3 animate-pulse" : ""}`}
              style={pct == null ? undefined : { width: `${pct}%` }}
            />
          </div>
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {queued
              ? "Waiting for an extraction worker"
              : inflight > 0
                ? `${inflight} jobs active${session.concurrency && session.batchSize
                  ? ` · ${session.concurrency} batches × ${session.batchSize}`
                  : ""}`
                : "Preparing the next batch"}
            {" · survives navigation"}
          </span>
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

  const failed = session.status === "failed";

  return (
    <Button
      variant="outline"
      size="sm"
      className={`h-9 gap-1.5 shrink-0 ${failed ? "border-destructive/50 text-destructive" : ""}`}
      disabled={loading || pending === 0}
      onClick={() => void start()}
      title={failed
        ? session.error || "The last skill extraction failed. Click to retry."
        : pending === 0
          ? "All Job Search titles have AI skills"
          : pending == null
            ? "Extract missing or failed skills for APPROVED Job Search titles"
            : `${pending} APPROVED job(s) pending or failed — extraction is shared globally`}
    >
      {loading
        ? <Loader2 className="w-4 h-4 animate-spin" />
        : failed
          ? <AlertCircle className="w-4 h-4" />
          : <Sparkles className="w-4 h-4" />}
      {failed ? "Retry skills" : "Extract skills"}
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
