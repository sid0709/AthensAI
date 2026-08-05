import { Check, ClipboardCheck, Copy, Loader2, RefreshCw, Sparkles, Video, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { Job, Session } from "../types";
import { askAiForPageAnswers, readOpenPageText, type FormAnswer } from "./askAi";
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
  onFinish(submitted: boolean): void;
}

export function SubmissionDialog({ state, onResume, onFinish }: SubmissionDialogProps) {
  if (state.status !== "review" || !state.job) return null;

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
        <div className="dialog-actions">
          <button className="primary-button" type="button" onClick={() => onFinish(true)}>
            Yes, submitted
          </button>
          <button className="secondary-button" type="button" onClick={() => onFinish(false)}>
            No, not submitted
          </button>
          <button className="text-button" type="button" onClick={() => void onResume()}>Keep recording</button>
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
}

export function AiAnswerPanel({ job, session, tabId = null, onClose }: AiAnswerPanelProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState("");
  const [answers, setAnswers] = useState<FormAnswer[]>([]);

  useEffect(() => {
    if (!job) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setAnswers([]);
    setSummary("");

    void (async () => {
      try {
        const { pageContext } = await readOpenPageText(tabId);
        const result = await askAiForPageAnswers(session, pageContext, job);
        if (cancelled) return;
        setAnswers(result.answers);
        setSummary(result.summary);
        if (!result.answers.length) {
          setError("No application questions were detected on the open page.");
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Ask AI failed.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [job, session, tabId]);

  if (!job) return null;

  async function copyAnswer(id: string, answer: string) {
    await navigator.clipboard.writeText(answer);
    setCopiedId(id);
    window.setTimeout(() => setCopiedId(null), 1600);
  }

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
              Answers are generated from the open page&apos;s text using your profile AI key and default model.
              Review every response before submitting.
            </p>
          </div>

          {loading ? (
            <div className="ai-loading" role="status">
              <Loader2 size={18} className="spin" aria-hidden="true" />
              <span>Reading the open page and drafting answers…</span>
            </div>
          ) : null}

          {error ? <p className="ai-error" role="alert">{error}</p> : null}
          {summary ? (
            <>
              <p className="ai-section-label">Page summary</p>
              <p className="ai-summary">{summary}</p>
            </>
          ) : null}

          {!loading && answers.length > 0 ? <p className="ai-section-label">Detected questions</p> : null}
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
