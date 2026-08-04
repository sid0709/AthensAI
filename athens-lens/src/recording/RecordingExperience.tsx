import { Check, ClipboardCheck, Copy, RefreshCw, Sparkles, Video, X } from "lucide-react";
import { useState } from "react";
import type { Job } from "../types";
import { MOCK_FORM_ANSWERS } from "./mockAnswers";
import { formatRecordingTime, type MockRecordingState } from "./useMockRecording";

interface RecordingDockProps {
  state: MockRecordingState;
  onRestart(): void;
  onComplete(): void;
  onAskAi(job: Job): void;
}

export function RecordingDock({ state, onRestart, onComplete, onAskAi }: RecordingDockProps) {
  if (state.status !== "recording" || !state.job) return null;

  return (
    <aside className="recording-dock" aria-label="Mock application recording">
      <div className="recording-status">
        <span className="recording-dot" aria-hidden="true" />
        <span>
          <strong>Recording application</strong>
          <small>Demo MP4 · {formatRecordingTime(state.elapsedSeconds)}</small>
        </span>
      </div>
      <div className="recording-actions">
        <button className="recording-icon-button" type="button" onClick={() => onAskAi(state.job!)}>
          <Sparkles size={17} aria-hidden="true" />
          <span>Ask AI</span>
        </button>
        <button className="recording-icon-button" type="button" onClick={onRestart}>
          <RefreshCw size={17} aria-hidden="true" />
          <span>Restart</span>
        </button>
        <button className="complete-bid-button" type="button" onClick={onComplete}>
          Complete Bid
        </button>
      </div>
    </aside>
  );
}

interface SubmissionDialogProps {
  state: MockRecordingState;
  onResume(): void;
  onFinish(submitted: boolean): void;
}

export function SubmissionDialog({ state, onResume, onFinish }: SubmissionDialogProps) {
  if (state.status !== "review" || !state.job) return null;

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirmation-dialog" role="dialog" aria-modal="true" aria-labelledby="submission-title">
        <span className="dialog-icon" aria-hidden="true"><ClipboardCheck size={22} /></span>
        <h2 id="submission-title">Did you submit this bid?</h2>
        <p>The mock recording stopped at {formatRecordingTime(state.elapsedSeconds)}. Choose the outcome for {state.job.title}.</p>
        <div className="dialog-actions">
          <button className="primary-button" type="button" onClick={() => onFinish(true)}>
            Yes, submitted
          </button>
          <button className="secondary-button" type="button" onClick={() => onFinish(false)}>
            No, not submitted
          </button>
          <button className="text-button" type="button" onClick={onResume}>Keep recording</button>
        </div>
      </section>
    </div>
  );
}

interface AiAnswerPanelProps {
  job: Job | null;
  onClose(): void;
}

export function AiAnswerPanel({ job, onClose }: AiAnswerPanelProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

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
            <p>Mock answers only. Review every response and add truthful details before submitting.</p>
          </div>
          <p className="ai-section-label">Detected questions</p>
          {MOCK_FORM_ANSWERS.map((item) => (
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
  state: MockRecordingState;
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
