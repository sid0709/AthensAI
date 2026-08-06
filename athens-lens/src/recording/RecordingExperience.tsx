import { Check, ClipboardCheck, Copy, Loader2, RefreshCw, Sparkles, Video, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { Job, Session } from "../types";
import {
  askAiForPageAnswersStream,
  readOpenPageText,
  type AskAiTiming,
  type AskAiUsage,
  type FormAnswer,
  type PageContext,
} from "./askAi";
import { formatRecordingTime, type ApplicationRecordingState } from "./useApplicationRecording";

type AskPhase = "reading" | "asking" | "done";

function formatDurationMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}

function formatAskAiTimingLine(params: {
  captureMs: number | null;
  timing: AskAiTiming | null;
  usage: AskAiUsage | null;
  phase: AskPhase;
  askElapsedMs: number | null;
}): string {
  const parts: string[] = [];
  if (params.captureMs != null) parts.push(`capture ${formatDurationMs(params.captureMs)}`);

  if (params.phase === "asking") {
    if (params.askElapsedMs != null) parts.push(`streaming ${formatDurationMs(params.askElapsedMs)}`);
    return parts.join(" · ");
  }

  const timing = params.timing;
  if (timing) {
    if (timing.clientTtftMs != null) parts.push(`first token ${formatDurationMs(timing.clientTtftMs)}`);
    parts.push(`total ${formatDurationMs(timing.clientTotalMs)}`);
    if (timing.llmMs != null) parts.push(`llm ${formatDurationMs(timing.llmMs)}`);
    if (timing.model) parts.push(timing.model);
  }

  const usage = params.usage;
  if (usage) {
    const inTok = usage.inputTokens ?? 0;
    const outTok = usage.outputTokens ?? 0;
    if (inTok || outTok) parts.push(`${inTok.toLocaleString()} in / ${outTok.toLocaleString()} out`);
  }

  return parts.join(" · ");
}

interface RecordingDockProps {
  state: ApplicationRecordingState;
  activeRecordingCount?: number;
  onRestart(): void;
  onComplete(): void;
  onAskAi(job: Job): void;
}

export function RecordingDock({
  state,
  activeRecordingCount = 1,
  onRestart,
  onComplete,
  onAskAi,
}: RecordingDockProps) {
  if (state.status !== "recording" || !state.job) return null;
  const otherCount = Math.max(0, activeRecordingCount - 1);

  return (
    <aside className="recording-dock" aria-label="Application recording">
      <div className="recording-status">
        <span className="recording-dot" aria-hidden="true" />
        <span>
          <strong>Recording application ({state.job.company})</strong>
          <small>Role · {state.job.title}</small>
          <small>Live tab capture · {formatRecordingTime(state.elapsedSeconds)}</small>
          {state.resumeOriginalName ? (
            <small className="recording-resume-line" aria-label="Uploaded résumé">
              {state.resumeRenamed && state.resumeCleanedName
                ? `Résumé · ${state.resumeOriginalName} → ${state.resumeCleanedName}`
                : `Résumé · ${state.resumeOriginalName}`}
            </small>
          ) : (
            <small className="recording-resume-line recording-resume-line--pending">
              Waiting for résumé upload…
            </small>
          )}
          {otherCount > 0 ? (
            <small>
              {otherCount === 1
                ? "1 other tab also recording — switch browser tabs to manage it"
                : `${otherCount} other tabs also recording — switch browser tabs to manage them`}
            </small>
          ) : null}
        </span>
      </div>
      <div className="recording-actions">
        <button className="recording-icon-button" type="button" onClick={() => onAskAi(state.job!)}>
          <Sparkles size={17} aria-hidden="true" />
          <span>Ask AI</span>
        </button>
        <button className="recording-icon-button" type="button" onClick={() => void onRestart()}>
          <RefreshCw size={17} aria-hidden="true" />
          <span>Restart</span>
        </button>
        <button className="complete-bid-button" type="button" onClick={() => void onComplete()}>
          Complete Bid
        </button>
      </div>
    </aside>
  );
}

interface SubmissionDialogProps {
  state: ApplicationRecordingState;
  onResume(): void | Promise<void>;
  onFinish(submitted: boolean): void | Promise<void>;
}

export function SubmissionDialog({ state, onResume, onFinish }: SubmissionDialogProps) {
  if ((state.status !== "review" && state.status !== "saving") || !state.job) return null;
  const saving = state.status === "saving";

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirmation-dialog" role="dialog" aria-modal="true" aria-labelledby="submission-title">
        <span className="dialog-icon" aria-hidden="true"><ClipboardCheck size={22} /></span>
        <h2 id="submission-title">Did you submit this bid?</h2>
        <p>
          The recording stopped at {formatRecordingTime(state.elapsedSeconds)}
          {state.savedFilename ? ` and saved as ${state.savedFilename}` : ""}.
          Choose the outcome for {state.job.title}.
        </p>
        {state.resumeOriginalName ? (
          <p className="dialog-resume-audit" aria-label="Uploaded résumé">
            {state.resumeRenamed && state.resumeCleanedName
              ? `Résumé uploaded as ${state.resumeCleanedName} (original ${state.resumeOriginalName})`
              : `Résumé file · ${state.resumeOriginalName}`}
          </p>
        ) : null}
        {state.error ? <p className="dialog-error" role="alert">{state.error}</p> : null}
        {saving ? (
          <p className="ai-loading" role="status">
            <Loader2 size={18} className="spin" aria-hidden="true" />
            <span>Saving recording and AI answers to Athens…</span>
          </p>
        ) : null}
        <div className="dialog-actions">
          <button
            className="primary-button"
            type="button"
            disabled={saving}
            onClick={() => void onFinish(true)}
          >
            Yes, submitted
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={saving}
            onClick={() => void onFinish(false)}
          >
            No, not submitted
          </button>
          <button
            className="text-button"
            type="button"
            disabled={saving}
            onClick={() => void onResume()}
          >
            Keep recording
          </button>
        </div>
      </section>
    </div>
  );
}

interface AiAnswerPanelProps {
  job: Job | null;
  session: Session;
  tabId?: number | null;
  onClose(): void;
  onAnswers?(payload: {
    jobId: string;
    answers: FormAnswer[];
    summary: string;
    pageContext: PageContext | null;
    mode: string;
  }): void;
}

export function AiAnswerPanel({ job, session, tabId = null, onClose, onAnswers }: AiAnswerPanelProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [phase, setPhase] = useState<AskPhase>("reading");
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState("");
  const [answers, setAnswers] = useState<FormAnswer[]>([]);
  const [streamText, setStreamText] = useState("");
  const [formTree, setFormTree] = useState("");
  const [captureMeta, setCaptureMeta] = useState<PageContext["readMeta"] | null>(null);
  const [pageUrl, setPageUrl] = useState("");
  const [captureMs, setCaptureMs] = useState<number | null>(null);
  const [timing, setTiming] = useState<AskAiTiming | null>(null);
  const [usage, setUsage] = useState<AskAiUsage | null>(null);
  const [askElapsedMs, setAskElapsedMs] = useState<number | null>(null);

  useEffect(() => {
    if (!job) return;
    let cancelled = false;
    const abort = new AbortController();
    setPhase("reading");
    setError(null);
    setAnswers([]);
    setSummary("");
    setStreamText("");
    setFormTree("");
    setCaptureMeta(null);
    setPageUrl("");
    setCaptureMs(null);
    setTiming(null);
    setUsage(null);
    setAskElapsedMs(null);

    void (async () => {
      try {
        const captureStartedAt = Date.now();
        const read = await readOpenPageText(tabId);
        if (cancelled) return;
        setCaptureMs(Date.now() - captureStartedAt);

        const visibleText = String(read.pageContext.visibleText || "").trim();
        const tree = String(read.pageContext.formTree || "").trim();
        setFormTree(tree);
        setCaptureMeta(read.pageContext.readMeta ?? null);
        setPageUrl(String(read.pageContext.url || "").trim());

        if (!visibleText && !tree) {
          setError("No readable text on the focused tab. Click the application form page, then try Ask AI again.");
          setPhase("done");
          return;
        }

        setPhase("asking");
        const askStartedAt = Date.now();
        const tick = window.setInterval(() => {
          if (!cancelled) setAskElapsedMs(Date.now() - askStartedAt);
        }, 200);
        let result: Awaited<ReturnType<typeof askAiForPageAnswersStream>>;
        try {
          result = await askAiForPageAnswersStream(session, read.pageContext, job, {
            signal: abort.signal,
            onToken: (text) => {
              if (cancelled) return;
              setStreamText((current) => current + text);
            },
            onAnswers: (nextAnswers) => {
              if (cancelled) return;
              setAnswers(nextAnswers);
            },
          });
        } finally {
          window.clearInterval(tick);
        }
        if (cancelled) return;
        setAnswers(result.answers);
        setSummary(result.summary);
        if (result.streamText) setStreamText(result.streamText);
        setTiming(result.timing);
        setUsage(result.usage);
        setAskElapsedMs(result.timing.clientTotalMs);
        onAnswers?.({
          jobId: job.id,
          answers: result.answers,
          summary: result.summary,
          pageContext: read.pageContext,
          mode: result.mode,
        });
        if (!result.answers.length) {
          setError("AI returned no form answers for this page.");
        }
        setPhase("done");
      } catch (loadError) {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : "Ask AI failed.");
        setPhase("done");
      }
    })();

    return () => {
      cancelled = true;
      abort.abort();
    };
  }, [job, session, tabId, onAnswers]);

  if (!job) return null;

  async function copyAnswer(id: string, answer: string) {
    await navigator.clipboard.writeText(answer);
    setCopiedId(id);
    window.setTimeout(() => setCopiedId(null), 1600);
  }

  const oakNodeCount = captureMeta?.oakNodeCount ?? 0;
  const oakFrameCount = captureMeta?.oakFrameCount ?? 0;
  const oakFieldCount = captureMeta?.oakFieldCount ?? 0;
  const showOakSection = phase !== "reading" || Boolean(formTree);
  const timingLine = formatAskAiTimingLine({
    captureMs,
    timing,
    usage,
    phase,
    askElapsedMs,
  });

  return (
    <div className="assistant-backdrop" role="presentation">
      <aside className="ai-answer-panel" role="dialog" aria-modal="true" aria-labelledby="ai-panel-title">
        <header>
          <span className="ai-mark" aria-hidden="true"><Sparkles size={18} /></span>
          <div>
            <h2 id="ai-panel-title">Form answers</h2>
            <p>{job.title}</p>
          </div>
          <button className="icon-button" type="button" aria-label="Close AI answers" onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="ai-answer-scroll">
          <div className="ai-notice">
            <Video size={16} aria-hidden="true" />
            <p>
              Drafted from the open page&apos;s form tree and your profile. Copy each answer into the form, then review before submitting.
            </p>
          </div>

          <section className="ai-debug-block" aria-label="Oak form capture">
            <p className="ai-section-label">Form capture</p>
            {phase === "reading" ? (
              <div className="ai-loading" role="status">
                <Loader2 size={18} className="spin" aria-hidden="true" />
                <span>Capturing interactive form tree…</span>
              </div>
            ) : null}

            {showOakSection && formTree ? (
              <>
                <p className="ai-debug-meta">
                  {pageUrl ? `${pageUrl} · ` : ""}
                  {oakFieldCount > 0 ? `${oakFieldCount} fields` : oakNodeCount > 0 ? `${oakNodeCount} nodes` : "capture ready"}
                  {oakFrameCount > 1 ? ` · ${oakFrameCount} frames` : ""}
                  {captureMs != null ? ` · ${formatDurationMs(captureMs)}` : ""}
                  {" · algorithmic (no AI)"}
                </p>
                <pre className="ai-debug-pre ai-debug-pre--oak">{formTree}</pre>
              </>
            ) : null}

            {phase !== "reading" && !formTree ? (
              <p className="ai-summary">No interactive form tree on this tab — using page text only.</p>
            ) : null}
          </section>

          <section className="ai-debug-block" aria-label="AI response">
            <p className="ai-section-label">AI response</p>
            {timingLine ? <p className="ai-debug-meta" aria-live="polite">{timingLine}</p> : null}

            {phase === "reading" ? (
              <div className="ai-loading" role="status">
                <Loader2 size={18} className="spin" aria-hidden="true" />
                <span>Waiting for form capture…</span>
              </div>
            ) : null}

            {phase === "asking" && !streamText && answers.length === 0 ? (
              <div className="ai-loading" role="status">
                <Loader2 size={18} className="spin" aria-hidden="true" />
                <span>Streaming answers (gpt-5-nano)…</span>
              </div>
            ) : null}

            {streamText && answers.length === 0 ? (
              <pre className="ai-debug-pre ai-debug-pre--stream" aria-live="polite">{streamText}</pre>
            ) : null}

            {phase === "done" && error ? <p className="ai-error" role="alert">{error}</p> : null}

            {answers.length > 0 ? (
              <p className="ai-section-label ai-section-label--nested">
                {answers.length} answer{answers.length === 1 ? "" : "s"}
                {phase === "asking" ? " so far…" : " ready to copy"}
              </p>
            ) : null}
            {answers.map((item) => (
              <article className="answer-card" key={item.id}>
                <h3>{item.question}</h3>
                <p>{item.answer}</p>
                <button className="copy-answer-button" type="button" onClick={() => void copyAnswer(item.id, item.answer)}>
                  {copiedId === item.id ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
                  {copiedId === item.id ? "Copied" : "Copy answer"}
                </button>
              </article>
            ))}

            {phase === "done" && !error && summary && answers.length === 0 ? (
              <p className="ai-summary">{summary}</p>
            ) : null}

            {phase === "done" && !error && !summary && answers.length === 0 && !streamText ? (
              <p className="ai-summary">(no AI response)</p>
            ) : null}
          </section>
        </div>
      </aside>
    </div>
  );
}

interface BidOutcomeToastProps {
  state: ApplicationRecordingState;
  onDismiss(): void;
}

export function BidOutcomeToast({ state, onDismiss }: BidOutcomeToastProps) {
  if (!state.lastOutcome || !state.job) return null;

  return (
    <div className="outcome-toast" role="status">
      <Check size={17} aria-hidden="true" />
      <span>{state.lastOutcome === "submitted" ? "Bid marked as submitted" : "Bid marked as not submitted"}</span>
      <button type="button" aria-label="Dismiss" onClick={onDismiss}><X size={16} aria-hidden="true" /></button>
    </div>
  );
}

interface RecordingErrorToastProps {
  message: string | null;
  onDismiss(): void;
}

export function RecordingErrorToast({ message, onDismiss }: RecordingErrorToastProps) {
  if (!message) return null;
  return (
    <div className="outcome-toast outcome-toast--error" role="alert">
      <span>{message}</span>
      <button type="button" aria-label="Dismiss" onClick={onDismiss}><X size={16} aria-hidden="true" /></button>
    </div>
  );
}
