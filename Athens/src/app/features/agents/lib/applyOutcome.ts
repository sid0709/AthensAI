/**
 * Decide whether an application succeeded by reading the page after submit.
 * Purely language/structure based (innerText cues + whether any fillable control
 * remains) — no vendor or site-specific strings, per Guide.md.
 */

const SUCCESS_CUES =
  /\b(thank you|thanks for applying|application (was |has been )?(received|submitted|sent|complete[d]?)|successfully (submitted|applied|sent)|we('| ha)ve received your application|your application (has been|was) (received|submitted|sent)|submission (received|complete)|applied successfully|no longer accepting)\b/i;

const ERROR_CUES =
  /\b(is required|this field|please (fill|complete|correct|enter|select|provide)|required field|cannot be (blank|empty)|must be|invalid|enter a valid|fix the (errors|following)|there (was|were) (an? )?error)\b/i;

const RESUME_REQUIRED =
  /\b(resume|cv)\b[^.\n]{0,48}\b(is required|required)\b|\b(is required|required)\b[^.\n]{0,48}\b(resume|cv)\b/i;

export interface ApplyPageState {
  /** Page innerText (trimmed/truncated). */
  text: string;
  /** Count of still-fillable controls (visible inputs/textareas/selects/contenteditable). */
  controlCount: number;
  /** Whether the executor reported it clicked a submit control. */
  submitted: boolean;
  /** File inputs the plan tagged for résumé upload. */
  filesExpected?: number;
  /** Inputs that received the tailored PDF. */
  filesAttached?: number;
  /** Greenhouse-only: number of emailed-code security-input boxes present on the page. */
  otpInputs?: number;
}

export interface ApplyOutcome {
  applied: boolean;
  reason: string;
}

export function classifyApplyOutcome(state: ApplyPageState): ApplyOutcome {
  const text = state.text || "";

  if (state.filesExpected && state.filesExpected > 0 && (state.filesAttached ?? 0) === 0) {
    return { applied: false, reason: "Résumé was not attached to the form" };
  }

  if (RESUME_REQUIRED.test(text)) {
    return { applied: false, reason: "Résumé/CV still required on the page" };
  }

  if (ERROR_CUES.test(text)) {
    return { applied: false, reason: "Validation/error text on the page" };
  }

  if (SUCCESS_CUES.test(text)) {
    return { applied: true, reason: "Confirmation text detected" };
  }

  if (state.controlCount === 0) {
    return { applied: true, reason: "No form left to fill" };
  }

  if (state.submitted) {
    return { applied: true, reason: "Submitted with no visible errors" };
  }

  return { applied: false, reason: "Could not confirm submission" };
}
