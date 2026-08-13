import React from "react";
import { AlertCircle, Loader2, Sparkles, Square } from "lucide-react";
import { useJobSkillExtraction } from "../hooks/useJobSkillExtraction";

/**
 * Toolbar control to run AI Analyze over APPROVED temp jobs pending analysis,
 * with immediate Stop and live progress.
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
          : "Analyzing…";
    return (
      <div className="athens-toolbar-actions" aria-live="polite">
        <div className="athens-progress">
          <div className="athens-progress__meta">
            <span>{progressLabel}</span>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>
              {total != null ? `${processed}/${total}` : `${processed} done`}
            </span>
          </div>
          <div
            className="athens-progress__track"
            role="progressbar"
            aria-label={progressLabel}
            aria-valuemin={0}
            aria-valuemax={total ?? undefined}
            aria-valuenow={pct == null ? undefined : processed}
          >
            <div
              className={`athens-progress__bar${pct == null ? " is-indeterminate" : ""}`}
              style={pct == null ? undefined : { width: `${pct}%` }}
            />
          </div>
          <span className="athens-progress__meta">
            {queued
              ? "Waiting for an AI analyze worker"
              : inflight > 0
                ? `${inflight} jobs active${session.concurrency && session.batchSize
                  ? ` · ${session.concurrency} batches × ${session.batchSize}`
                  : ""}`
                : "Preparing the next batch"}
            {" · survives navigation"}
          </span>
        </div>
        <button
          type="button"
          className="athens-btn"
          disabled={loading || session.status === "stopping"}
          onClick={() => void stop()}
        >
          {loading ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Square size={14} aria-hidden="true" />}
          Stop
        </button>
      </div>
    );
  }

  const failed = session.status === "failed";

  return (
    <button
      type="button"
      className="athens-btn"
      disabled={loading || pending === 0}
      onClick={() => void start()}
      title={failed
        ? session.error || "The last AI analyze run failed. Click to retry."
        : pending === 0
          ? "All APPROVED titles have been AI-analyzed"
          : pending == null
            ? "Fill job details and skills for APPROVED titles"
            : `${pending} APPROVED job(s) pending or failed — AI analyze is shared globally`}
    >
      {loading
        ? <Loader2 size={16} className="animate-spin" aria-hidden="true" />
        : failed
          ? <AlertCircle size={16} aria-hidden="true" />
          : <Sparkles size={16} aria-hidden="true" />}
      {failed ? "Retry AI analyze" : "AI analyze"}
      {pending != null ? (
        <span
          className={pending === 0 ? "athens-badge is-muted" : "athens-badge"}
          aria-label={`${pending} jobs pending AI analyze`}
        >
          {pending.toLocaleString()}
        </span>
      ) : null}
    </button>
  );
}
