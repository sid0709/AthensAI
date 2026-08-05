import { Check, ClipboardCheck, Copy, Loader2, RefreshCw, Sparkles, Video, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { Job, Session } from "../types";
import { askAiForPageAnswers, readOpenPageText, type FormAnswer, type PageContext } from "./askAi";
import { formatRecordingTime, type ApplicationRecordingState } from "./useApplicationRecording";

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

type AskPhase = "reading" | "asking" | "done";

export function AiAnswerPanel({ job, session, tabId = null, onClose, onAnswers }: AiAnswerPanelProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [phase, setPhase] = useState<AskPhase>("reading");
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState("");
  const [answers, setAnswers] = useState<FormAnswer[]>([]);
  const [formTree, setFormTree] = useState("");
  const [captureMeta, setCaptureMeta] = useState<PageContext["readMeta"] | null>(null);
  const [pageUrl, setPageUrl] = useState("");

  useEffect(() => {
    if (!job) return;
    let cancelled = false;
    setPhase("reading");
    setError(null);
    setAnswers([]);
    setSummary("");
    setFormTree("");
    setCaptureMeta(null);
    setPageUrl("");

    void (async () => {
      try {
        const read = await readOpenPageText(tabId);
        if (cancelled) return;

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
        const result = await askAiForPageAnswers(session, read.pageContext, job);
        if (cancelled) return;
        setAnswers(result.answers);
        setSummary(result.summary);
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
  const showOakSection = phase !== "reading" || Boolean(formTree);

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
                  {oakNodeCount > 0 ? `${oakNodeCount} nodes` : "tree ready"}
                  {oakFrameCount > 1 ? ` · ${oakFrameCount} frames` : ""}
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
            {phase === "reading" || phase === "asking" ? (
              <div className="ai-loading" role="status">
                <Loader2 size={18} className="spin" aria-hidden="true" />
                <span>
                  {phase === "reading"
                    ? "Waiting for form capture…"
                    : "Generating answers from the form tree + profile…"}
                </span>
              </div>
            ) : null}

            {phase === "done" && error ? <p className="ai-error" role="alert">{error}</p> : null}

            {phase === "done" && answers.length > 0 ? (
              <p className="ai-section-label ai-section-label--nested">{answers.length} answers ready to copy</p>
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

            {phase === "done" && !error && !summary && answers.length === 0 ? (
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
