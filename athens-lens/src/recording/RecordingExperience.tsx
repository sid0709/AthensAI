import { Check, ClipboardCheck, Copy, Loader2, RefreshCw, Sparkles, Video, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { Job, Session } from "../types";
import { askAiForPageAnswers, readOpenPageText, type FormAnswer, type PageContext } from "./askAi";
import { formatRecordingTime, type ApplicationRecordingState } from "./useApplicationRecording";

interface RecordingDockProps {
  state: ApplicationRecordingState;
  onRestart(): void;
  onComplete(): void;
  onAskAi(job: Job): void;
}

export function RecordingDock({ state, onRestart, onComplete, onAskAi }: RecordingDockProps) {
  if (state.status !== "recording" || !state.job) return null;

  return (
    <aside className="recording-dock" aria-label="Application recording">
      <div className="recording-status">
        <span className="recording-dot" aria-hidden="true" />
        <span>
          <strong>Recording application ({state.job.company})</strong>
          <small>Role · {state.job.title}</small>
          <small>Live tab capture · {formatRecordingTime(state.elapsedSeconds)}</small>
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
  const [pageContext, setPageContext] = useState<PageContext | null>(null);
  const [readTabId, setReadTabId] = useState<number | null>(null);
  const [summary, setSummary] = useState("");
  const [answers, setAnswers] = useState<FormAnswer[]>([]);

  useEffect(() => {
    if (!job) return;
    let cancelled = false;
    setPhase("reading");
    setError(null);
    setPageContext(null);
    setReadTabId(null);
    setAnswers([]);
    setSummary("");

    void (async () => {
      try {
        const read = await readOpenPageText(tabId);
        if (cancelled) return;
        setPageContext(read.pageContext);
        setReadTabId(read.tabId);

        const visibleText = String(read.pageContext.visibleText || "").trim();
        if (!visibleText) {
          setError("No readable text on the focused tab (see innerText above). Click the application form page, then try Ask AI again.");
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
          setError("AI returned no form answers from the innerText above.");
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

  const innerText = pageContext?.visibleText ?? "";
  const innerTextReady = pageContext != null;
  const meta = pageContext?.readMeta;

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
              Drafted from the open page&apos;s text and your profile. Copy each answer into the form, then review before submitting.
            </p>
          </div>

          <section className="ai-debug-block" aria-label="Focused tab innerText">
            <p className="ai-section-label">innerText</p>
            {phase === "reading" && !innerTextReady ? (
              <div className="ai-loading" role="status">
                <Loader2 size={18} className="spin" aria-hidden="true" />
                <span>Reading focused tab innerText…</span>
              </div>
            ) : (
              <>
                <p className="ai-debug-meta">
                  {readTabId != null ? `tab ${readTabId}` : "tab ?"}
                  {pageContext?.url ? ` · ${pageContext.url}` : ""}
                  {meta ? ` · ${meta.charCount ?? innerText.length} chars` : ` · ${innerText.length} chars`}
                  {meta?.formCount != null ? ` · ${meta.formCount} fields` : ""}
                  {meta?.note ? ` · ${meta.note}` : ""}
                </p>
                <pre className="ai-debug-pre">{innerText.trim() ? innerText : "(empty)"}</pre>
              </>
            )}
          </section>

          <section className="ai-debug-block" aria-label="AI response">
            <p className="ai-section-label">AI response</p>
            {phase === "asking" ? (
              <div className="ai-loading" role="status">
                <Loader2 size={18} className="spin" aria-hidden="true" />
                <span>Generating answers from innerText + profile…</span>
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
