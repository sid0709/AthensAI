/** Linguistic applicant-identity rules — not vendor or employer names. */

const AI_TOOL_QUESTION_RE =
  /\b(ai|artificial intelligence|automated employment|automated decision|automated screening|automated assessment|automated hiring)\b/i;

const YES_LIKE_RE =
  /^(yes|y|true|i consent|i agree|agree|consent|i do consent)$/i;

export function looksLikeAiToolQuestion(
  label: string | null | undefined,
): boolean {
  return AI_TOOL_QUESTION_RE.test(String(label || ''));
}

/**
 * The applicant is a human. Never consent to AI / automated employment
 * decision / automated screening tools, and never claim they used those tools.
 */
export function rewriteApplicantIdentityValue(
  label: string | null | undefined,
  value: string | null | undefined,
): string | null | undefined {
  if (value == null || !looksLikeAiToolQuestion(label)) return value;
  const trimmed = String(value).trim();
  if (!trimmed) return value;
  if (YES_LIKE_RE.test(trimmed) || /^(i\s+)?(consent|agree)\b/i.test(trimmed)) {
    return 'No';
  }
  return value;
}

export function applyApplicantIdentityToPlan(plan: unknown): unknown {
  if (!plan || typeof plan !== 'object') return plan;
  const actions = (plan as { actions?: unknown }).actions;
  if (!Array.isArray(actions)) return plan;
  for (const action of actions) {
    if (!action || typeof action !== 'object') continue;
    const row = action as {
      expected_label?: string | null;
      value?: string | null;
    };
    const next = rewriteApplicantIdentityValue(row.expected_label, row.value);
    if (next !== row.value) row.value = next ?? null;
  }
  return plan;
}
