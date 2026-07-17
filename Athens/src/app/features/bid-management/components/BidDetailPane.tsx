import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Play,
  ExternalLink,
  Circle,
  CheckCircle2,
  Clock,
  Film,
  Lock,
  FileText,
  CalendarDays,
  Briefcase,
  MapPin,
  Banknote,
  Sparkles,
  Loader2,
  GraduationCap,
  AlertTriangle,
  History,
} from "lucide-react";
import { AgentResumePdfPreview } from "../../agents/components/AgentResumePdfPreview";
import { SlidePanel, SlidePanelHeader } from "../../../components/overlays";
import { useApplier } from "@/context/applier-context";
import { fetchBidResultAiUsage, fetchBidResultEvents } from "../../../api/bidResults";
import type {
  BidAiUsageRow,
  BidResult,
  BidResultStatus,
  BidReviewEvent,
  FlagLight,
} from "../types";
import { EDITABLE_STATUSES, canChangeStatus, isEditableStatus, isRejectableStatus } from "../types";
import { STATUS_LABELS, formatDuration, formatWhen } from "../lib";
import { useBidPreview } from "../hooks/useBidPreview";

function FlagDot({ label, value }: { label: string; value: FlagLight }) {
  const tone = value === "green" ? "green" : value === "red" ? "red" : "muted";
  return (
    <span className={`bm-flag ${tone}`}>
      <Circle className="w-2.5 h-2.5" fill="currentColor" />
      {label}
    </span>
  );
}

function StatusPill({ status }: { status: BidResultStatus }) {
  return <span className={`bm-status ${status}`}>{STATUS_LABELS[status]}</span>;
}

function MetaChip({
  icon: Icon,
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  children: ReactNode;
}) {
  return (
    <span className="bm-meta-chip">
      <Icon className="w-3 h-3" />
      {children}
    </span>
  );
}

function Section({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="bm-section">
      <div className="bm-section-head">
        <div className="bm-eyebrow">{title}</div>
        {action}
      </div>
      {children}
    </section>
  );
}

const EVENT_LABELS: Record<string, string> = {
  apply_start: "Apply started",
  submit: "Submitted",
  skip: "Skipped",
  reviewer_reject: "Rejected",
  skip_to_reject: "Skipped → Rejected",
  reviewer_mark_reviewed: "Marked reviewed",
  reviewer_undo: "Reviewer undo",
  vendor_mark_fixed: "Vendor marked fixed",
  resume_name_mismatch: "Résumé name mismatch",
  analyze: "Analyze (JD / flags)",
  recommend_resume: "Recommend resume",
};

function eventLabel(ev: BidReviewEvent): string {
  return EVENT_LABELS[ev.eventType] || ev.eventType;
}

function eventMetaLine(ev: BidReviewEvent): string | null {
  const meta = ev.meta;
  if (!meta) return null;
  const bits: string[] = [];
  if (typeof meta.summary === "string" && meta.summary.trim()) {
    bits.push(meta.summary.trim().slice(0, 120));
  }
  if (typeof meta.recommendedResumeStack === "string" && meta.recommendedResumeStack) {
    bits.push(`stack: ${meta.recommendedResumeStack}`);
  }
  if (meta.useCustomizedResume) bits.push("customized resume");
  if (typeof meta.recommendWarning === "string" && meta.recommendWarning) {
    bits.push(meta.recommendWarning);
  }
  if (typeof meta.reason === "string" && meta.reason) bits.push(meta.reason);
  if (typeof meta.resumeStackMatch === "string" && meta.resumeStackMatch) {
    bits.push(`upload vs stack: ${meta.resumeStackMatch}`);
  }
  return bits.length ? bits.join(" · ") : null;
}

function stackMatchLabel(match: BidResult["resumeStackMatch"]): string {
  if (match === "match") return "Match";
  if (match === "mismatch") return "Mismatch";
  if (match === "unknown") return "Unknown";
  return "—";
}

function formatUsd(cost: number | null): string {
  if (cost == null || !Number.isFinite(cost)) return "—";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(3)}`;
}

function featureLabel(feature: string | null): string {
  if (!feature) return "AI call";
  if (feature === "bid-job-analyze") return "Page analyze";
  if (feature === "bid-job-flags") return "Flags";
  if (feature === "bid-recommend-resume") return "Recommend resume";
  return feature;
}

function promptRejectReason(): string | null {
  const raw = window.prompt("Reject reason (optional — leave blank to skip):", "");
  if (raw === null) return null; // cancelled
  return raw.trim();
}

export function BidDetailPane({
  result,
  onClose,
  onWatch,
  onChangeStatus,
  lockDismiss = false,
}: {
  result: BidResult | null;
  onClose: () => void;
  onWatch: () => void;
  onChangeStatus: (
    id: string,
    status: BidResultStatus,
    options?: { rejectReason?: string | null },
  ) => void;
  /** Keep the detail sheet open while the recording player is up. */
  lockDismiss?: boolean;
}) {
  const { applier } = useApplier();
  const preview = useBidPreview(result?.jobId ?? null, result?.bidder.name);
  const [events, setEvents] = useState<BidReviewEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [aiUsage, setAiUsage] = useState<BidAiUsageRow[]>([]);
  const [aiUsageLoading, setAiUsageLoading] = useState(false);

  useEffect(() => {
    if (!result || !applier?.name) {
      setEvents([]);
      setAiUsage([]);
      return;
    }
    let cancelled = false;
    setEventsLoading(true);
    setAiUsageLoading(true);
    void fetchBidResultEvents(result.id, applier.name)
      .then((rows) => {
        if (!cancelled) setEvents(rows);
      })
      .catch(() => {
        if (!cancelled) setEvents([]);
      })
      .finally(() => {
        if (!cancelled) setEventsLoading(false);
      });
    void fetchBidResultAiUsage(result.id, applier.name)
      .then((rows) => {
        if (!cancelled) setAiUsage(rows);
      })
      .catch(() => {
        if (!cancelled) setAiUsage([]);
      })
      .finally(() => {
        if (!cancelled) setAiUsageLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    result?.id,
    result?.status,
    result?.resubmitCount,
    result?.rejectCount,
    result?.recommendedAt,
    result?.resumeOriginalName,
    applier?.name,
  ]);

  const editable = result ? isEditableStatus(result.status) : false;
  const rejectable = result ? isRejectableStatus(result.status) : false;
  const detail = preview.jobDetail || result?.jobDetail;
  // Prefer Bid-Monitor Library recommendation over job-preview stack.
  const recommended = result?.recommendedResume || preview.recommendedResume;
  const submission = result?.submissionResume;
  const desc = detail?.description?.trim() || "";
  const posted =
    detail?.postedLabel ||
    (detail?.postedAt ? formatWhen(detail.postedAt) : null) ||
    (result ? formatWhen(result.pooledAt) : null);

  const handleStatusChange = (next: BidResultStatus) => {
    if (!result) return;
    if (!canChangeStatus(result.status, next)) return;
    if (next === "rejected") {
      const reason = promptRejectReason();
      if (reason === null) return;
      onChangeStatus(result.id, next, { rejectReason: reason || null });
      return;
    }
    onChangeStatus(result.id, next);
  };

  return (
    <SlidePanel
      open={!!result}
      onOpenChange={(open) => {
        if (!open && !lockDismiss) onClose();
      }}
      width="xl"
      showClose={false}
      className="bm-detail-sheet"
      lockDismiss={lockDismiss}
    >
      {result ? (
        <>
          <SlidePanelHeader
            title={result.status === "pending" ? "Bid ready" : "Bid result"}
            onClose={onClose}
          />
          <AnimatePresence mode="wait">
            <motion.div
              key={result.id}
              className="bm-detail"
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 8 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="bm-detail-sticky">
                <div className="bm-detail-head">
                  <div>
                    <h2 className="bm-detail-title">{result.job.title}</h2>
                    <p className="bm-detail-sub">
                      {result.job.company} · {result.job.location}
                    </p>
                  </div>
                  {editable ? (
                    <select
                      className="bm-status-select"
                      value={result.status}
                      aria-label="Edit status"
                      onChange={(e) =>
                        handleStatusChange(e.target.value as BidResultStatus)
                      }
                    >
                      {EDITABLE_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="bm-status-locked">
                      <StatusPill status={result.status} />
                      {rejectable && result.status === "skipped" ? (
                        <button
                          type="button"
                          className="bm-reject-btn"
                          onClick={() => handleStatusChange("rejected")}
                        >
                          Reject
                        </button>
                      ) : (
                        <span className="bm-lock-hint">
                          <Lock className="w-3 h-3" />
                          Locked
                        </span>
                      )}
                    </div>
                  )}
                </div>

                <div className="bm-detail-badges">
                  {(result.resubmitCount ?? 0) > 0 ? (
                    <span className="bm-mini-badge warn">
                      Resubmitted {result.resubmitCount}×
                    </span>
                  ) : null}
                  {result.rejectSource ? (
                    <span className="bm-mini-badge">
                      From {result.rejectSource === "skipped" ? "Skipped" : "Submitted"}
                    </span>
                  ) : null}
                  {(result.rejectCount ?? 0) > 0 ? (
                    <span className="bm-mini-badge muted">
                      Rejected {result.rejectCount}×
                    </span>
                  ) : null}
                  {result.resumeMismatch ? (
                    <span className="bm-mini-badge danger">Résumé name mismatch</span>
                  ) : null}
                  {result.resumeStackMatch === "mismatch" ? (
                    <span className="bm-mini-badge danger">Stack mismatch</span>
                  ) : null}
                  {result.resumeStackMatch === "match" ? (
                    <span className="bm-mini-badge">Stack match</span>
                  ) : null}
                </div>

                <div className="bm-detail-row">
                  <div className="bm-bidder-chip">
                    <span className="bm-avatar sm">{result.bidder.avatarInitials}</span>
                    <div>
                      <div className="bm-bidder-name">{result.bidder.name}</div>
                      <div className="bm-muted">Bidder</div>
                    </div>
                  </div>
                  {result.matchScore != null ? (
                    <div className="bm-score">
                      <span className="bm-score-val">{result.matchScore}%</span>
                      <span className="bm-muted">Match</span>
                    </div>
                  ) : null}
                </div>

                <div className="bm-chip-wrap">
                  <FlagDot label="Remote" value={result.flags.remote} />
                  <FlagDot label="No clearance" value={result.flags.clearance} />
                  {detail?.workMode ? <MetaChip icon={MapPin}>{detail.workMode}</MetaChip> : null}
                  {detail?.salary ? <MetaChip icon={Banknote}>{detail.salary}</MetaChip> : null}
                  {posted ? <MetaChip icon={CalendarDays}>{posted}</MetaChip> : null}
                  {detail?.seniority ? (
                    <MetaChip icon={Briefcase}>{detail.seniority}</MetaChip>
                  ) : null}
                  {result.durationSec != null ? (
                    <MetaChip icon={Clock}>{formatDuration(result.durationSec)}</MetaChip>
                  ) : null}
                  {result.biddingDurationSec != null ? (
                    <MetaChip icon={Clock}>
                      Bid {formatDuration(result.biddingDurationSec)}
                    </MetaChip>
                  ) : null}
                </div>
              </div>

              <div className="bm-detail-scroll subtle-scroll">
                {result.analysisSummary ? (
                  <Section title="Analyze summary">
                    <div className="bm-notes-box">{result.analysisSummary}</div>
                  </Section>
                ) : null}

                {result.recommendedResumeStack ||
                result.useCustomizedResume ||
                result.resumeOriginalName ||
                result.recommendWarning ? (
                  <Section title="Recommended vs uploaded">
                    <div
                      className={`bm-resume-mismatch-banner ${
                        result.resumeStackMatch === "mismatch" || result.resumeMismatch
                          ? "warn"
                          : ""
                      }`}
                    >
                      <AlertTriangle className="w-3.5 h-3.5" />
                      <div>
                        <strong>
                          Upload vs Library stack: {stackMatchLabel(result.resumeStackMatch)}
                        </strong>
                        <div className="bm-resume-audit-lines">
                          <div>
                            Recommended:{" "}
                            <code>
                              {result.recommendedResumeStack ||
                                (result.useCustomizedResume
                                  ? "Use customized resume"
                                  : "—")}
                            </code>
                          </div>
                          {result.resumeOriginalName ? (
                            <div>
                              Uploaded: <code>{result.resumeOriginalName}</code>
                            </div>
                          ) : (
                            <div>Uploaded: <code>—</code></div>
                          )}
                          {result.resumeExpectedName ? (
                            <div>
                              Canonical expected: <code>{result.resumeExpectedName}</code>
                            </div>
                          ) : null}
                          {result.resumeCleanedName ? (
                            <div>
                              Uploaded as: <code>{result.resumeCleanedName}</code>
                              {result.resumeRenamed ? " (renamed)" : ""}
                            </div>
                          ) : null}
                          {result.recommendedResumeReason ? (
                            <div>{result.recommendedResumeReason}</div>
                          ) : null}
                          {result.recommendWarning ? (
                            <div>{result.recommendWarning}</div>
                          ) : null}
                          {result.recommendedAt ? (
                            <div>Recommended {formatWhen(result.recommendedAt)}</div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </Section>
                ) : result.resumeMismatch ? (
                  <div className="bm-resume-mismatch-banner warn">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <div>
                      <strong>Résumé filename mismatch</strong>
                      <div className="bm-resume-audit-lines">
                        {result.resumeOriginalName ? (
                          <div>
                            Original: <code>{result.resumeOriginalName}</code>
                          </div>
                        ) : null}
                        {result.resumeExpectedName ? (
                          <div>
                            Expected: <code>{result.resumeExpectedName}</code>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ) : null}

                {result.status === "rejected" && result.rejectReason ? (
                  <div className="bm-reject-reason-box">
                    <strong>Reject reason</strong>
                    <p>{result.rejectReason}</p>
                  </div>
                ) : null}

                {preview.loading ? (
                  <div className="bm-preview-loading">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading job details…
                  </div>
                ) : null}
                {preview.error ? <div className="bm-preview-error">{preview.error}</div> : null}

                <Section title="Job overview">
                  <div className="bm-overview-grid">
                    <div>
                      <div className="bm-kv-label">Source</div>
                      <div className="bm-kv-val">{result.job.source}</div>
                    </div>
                    <div>
                      <div className="bm-kv-label">Posted</div>
                      <div className="bm-kv-val">{posted || "—"}</div>
                    </div>
                    <div>
                      <div className="bm-kv-label">Type</div>
                      <div className="bm-kv-val">{detail?.employmentType || "—"}</div>
                    </div>
                    <div>
                      <div className="bm-kv-label">Experience</div>
                      <div className="bm-kv-val">{detail?.experience || "—"}</div>
                    </div>
                    {detail?.applicantsText ? (
                      <div className="bm-overview-span">
                        <div className="bm-kv-label">Applicants</div>
                        <div className="bm-kv-val">{detail.applicantsText}</div>
                      </div>
                    ) : null}
                  </div>
                  {detail?.skills?.length ? (
                    <div className="bm-skill-row">
                      {detail.skills.slice(0, 12).map((s) => (
                        <span key={s} className="bm-skill-pill">
                          {s}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </Section>

                <Section title="Job description">
                  {desc ? (
                    <div className="bm-desc">{desc}</div>
                  ) : (
                    <div className="bm-empty-inline">No description available</div>
                  )}
                </Section>

                {editable && submission ? (
                  <Section title="Résumé used for submission">
                    <div className="bm-resume-card used">
                      <div className="bm-resume-icon">
                        <FileText className="w-4 h-4" />
                      </div>
                      <div className="bm-resume-body">
                        <div className="bm-resume-name">{submission.name}</div>
                        <div className="bm-resume-meta">
                          {submission.techStack || "Tailored stack"}
                          {submission.source ? ` · ${submission.source}` : ""}
                          {submission.scorePercent != null
                            ? ` · ${submission.scorePercent}% match`
                            : ""}
                        </div>
                        {submission.fileName ? (
                          <div className="bm-resume-file">{submission.fileName}</div>
                        ) : null}
                        {submission.usedAt ? (
                          <div className="bm-resume-file">
                            Submitted {formatWhen(submission.usedAt)}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </Section>
                ) : null}

                <Section
                  title={editable ? "Generated / recommended résumé" : "Generated résumé"}
                  action={
                    preview.hasGeneratedPdf ? (
                      <span className="bm-resume-badge">
                        <Sparkles className="w-3 h-3" />
                        PDF ready
                      </span>
                    ) : null
                  }
                >
                  {recommended || preview.hasGeneratedPdf ? (
                    <div className="bm-resume-card">
                      <div className="bm-resume-icon">
                        <GraduationCap className="w-4 h-4" />
                      </div>
                      <div className="bm-resume-body">
                        <div className="bm-resume-name">
                          {recommended?.name || "Generated résumé for this job"}
                        </div>
                        <div className="bm-resume-meta">
                          {recommended?.techStack || "Tailored draft"}
                          {recommended?.scorePercent != null
                            ? ` · ${recommended.scorePercent}% match`
                            : ""}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="bm-empty-inline">No generated résumé yet for this job</div>
                  )}
                  {preview.hasGeneratedPdf && result.jobId ? (
                    <div className="bm-pdf-frame">
                      <AgentResumePdfPreview
                        applierName={applier?.name || result.bidder.name}
                        jobId={result.jobId}
                        className="bm-pdf-iframe"
                      />
                    </div>
                  ) : null}
                </Section>

                <Section
                  title="Bidder activity"
                  action={
                    eventsLoading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin opacity-50" />
                    ) : (
                      <History className="w-3.5 h-3.5 opacity-40" />
                    )
                  }
                >
                  {events.length > 0 ? (
                    <ol className="bm-timeline-list events">
                      {events.map((ev) => {
                        const metaLine = eventMetaLine(ev);
                        return (
                          <li key={ev.id} className="done">
                            <CheckCircle2 className="w-4 h-4" />
                            <div>
                              <strong>{eventLabel(ev)}</strong>
                              <span>
                                {formatWhen(ev.createdAt)}
                                {ev.fromStatus && ev.toStatus
                                  ? ` · ${ev.fromStatus} → ${ev.toStatus}`
                                  : ""}
                                {ev.rejectReason ? ` · ${ev.rejectReason}` : ""}
                                {ev.rejectSource ? ` · source: ${ev.rejectSource}` : ""}
                                {metaLine ? ` · ${metaLine}` : ""}
                              </span>
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  ) : (
                    <ol className="bm-timeline-list">
                      <li className="done">
                        <CheckCircle2 className="w-4 h-4" />
                        <div>
                          <strong>
                            {result.status === "pending" ? "Bid ready" : "Pooled"}
                          </strong>
                          <span>{formatWhen(result.pooledAt)}</span>
                        </div>
                      </li>
                      <li className={result.recording || result.submittedAt ? "done" : "pending"}>
                        {result.recording ? (
                          <Film className="w-4 h-4" />
                        ) : (
                          <Clock className="w-4 h-4" />
                        )}
                        <div>
                          <strong>Recording</strong>
                          <span>
                            {result.recording
                              ? `${(result.recording.sizeBytes / 1024).toFixed(0)} KB · ${result.recording.contentType.split(";")[0]}`
                              : "Not uploaded yet"}
                          </span>
                        </div>
                      </li>
                      <li className={result.submittedAt ? "done" : "pending"}>
                        {result.submittedAt ? (
                          <CheckCircle2 className="w-4 h-4" />
                        ) : (
                          <Clock className="w-4 h-4" />
                        )}
                        <div>
                          <strong>
                            {result.status === "skipped"
                              ? "Skipped"
                              : result.status === "rejected"
                                ? "Rejected"
                                : "Submitted"}
                          </strong>
                          <span>{formatWhen(result.submittedAt)}</span>
                        </div>
                      </li>
                    </ol>
                  )}
                </Section>

                <Section
                  title="AI usage"
                  action={
                    aiUsageLoading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin opacity-50" />
                    ) : null
                  }
                >
                  {aiUsage.length > 0 ? (
                    <ul className="bm-ai-usage-list">
                      {aiUsage.map((row) => (
                        <li key={row.id} className="bm-ai-usage-row">
                          <div className="bm-ai-usage-head">
                            <strong>{featureLabel(row.feature)}</strong>
                            <span>{formatWhen(row.createdAt)}</span>
                          </div>
                          <div className="bm-ai-usage-meta">
                            {row.billedModel || row.requestedModel || "—"}
                            {" · "}
                            {row.totalTokens.toLocaleString()} tokens
                            {" · "}
                            {formatUsd(row.costUsd)}
                            {row.success ? "" : " · failed"}
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="bm-empty-inline">
                      {aiUsageLoading
                        ? "Loading AI usage…"
                        : "No AI calls logged for this bid yet"}
                    </div>
                  )}
                </Section>

                {result.notes ? (
                  <Section title="Notes">
                    <div className="bm-notes-box">{result.notes}</div>
                  </Section>
                ) : null}

                {!editable && result.status !== "skipped" && (
                  <div className="bm-locked-banner">
                    <Lock className="w-3.5 h-3.5" />
                    {result.status === "pending"
                      ? "Pending (Bid ready) status can’t be edited here — mark progress from Job Search / bidder flow."
                      : "In-Process tickets are locked until the bidder submits."}
                  </div>
                )}

                <div className="bm-actions">
                  {result.recording ? (
                    <button type="button" className="bm-primary" onClick={onWatch}>
                      <Play className="w-4 h-4" fill="currentColor" />
                      Watch recording
                    </button>
                  ) : (
                    <button type="button" className="bm-primary" disabled>
                      <Play className="w-4 h-4" />
                      No recording yet
                    </button>
                  )}
                  <a
                    className="bm-secondary"
                    href={result.job.applyUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Job link
                  </a>
                </div>

                {result.recording ? (
                  <div className="bm-storage-path">{result.recording.storagePath}</div>
                ) : null}
              </div>
            </motion.div>
          </AnimatePresence>
        </>
      ) : null}
    </SlidePanel>
  );
}
