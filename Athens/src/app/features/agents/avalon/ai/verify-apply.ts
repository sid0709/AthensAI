import { chatCompletion } from "./client";
import type { JsonSchemaDefinition } from "./chat-types";

/**
 * AI verification of a job application after the submit click. Instead of matching
 * brittle success/error phrases, we hand the page's innerText to the model and let
 * it judge the real outcome — this reliably distinguishes a true submission from a
 * page still asking for a verification code, showing validation errors, or unchanged.
 * Language-based only; no vendor/site strings.
 */

export type ApplyVerifyStatus = "success" | "needs_verification" | "error" | "incomplete";

const VERIFY_SYSTEM_PROMPT = [
  "You verify whether a job application was actually submitted, by reading the page's",
  "visible text AFTER the Submit button was clicked. Classify into exactly one status:",
  "- success: the application was received/submitted (confirmation, thank-you, 'application submitted',",
  "  'we received your application', or the form is gone / replaced by a success state).",
  "- needs_verification: the page asks for an emailed/one-time/security/verification code to finish",
  "  (e.g. 'a verification code was sent to …, enter the code'). The submit did NOT complete yet.",
  "- error: the page shows validation errors or 'required' messages — the submit was rejected.",
  "- incomplete: none of the above is clearly true; the form still appears present and unconfirmed.",
  "",
  "CRITICAL — empty page text: If the page text is empty/blank, use the controlCount (number of",
  "visible form controls still on the page) to decide:",
  "  • controlCount 0 AND text empty → success (form was removed, page likely navigated to a",
  "    confirmation/redirect that hasn't rendered yet).",
  "  • controlCount > 0 AND text empty → incomplete (form is still present but text read failed,",
  "    likely a CSP or script error — the submission is unconfirmed).",
  "  • If controlCount is not provided, treat empty text as incomplete (do not guess success).",
  "Judge from the text and controlCount together. Do not assume success just because a submit was clicked.",
].join("\n");

export const APPLY_VERIFY_SCHEMA: JsonSchemaDefinition = {
  name: "apply_verify",
  description: "Whether a job application was submitted, needs a code, errored, or is incomplete.",
  strict: true,
  schema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["success", "needs_verification", "error", "incomplete"] },
      reason: { type: "string", description: "One short sentence citing the page text that decided it." },
    },
    required: ["status", "reason"],
    additionalProperties: false,
  },
};

export interface AiUsage {
  model?: string | null;
  provider?: string | null;
  promptTokens: number;
  cachedTokens?: number;
  completionTokens: number;
  totalTokens: number;
  costUsd?: number;
  pricingRates?: {
    promptPer1M: number;
    completionPer1M: number;
  };
}

export interface ApplyVerifyResult {
  status: ApplyVerifyStatus;
  reason: string;
  usage?: AiUsage;
}

/** Normalize an ai-bff usage block (with optional cached-token detail) to AiUsage. */
export function toAiUsage(u: unknown): AiUsage | undefined {
  const usage = u as
    | {
        model?: string | null;
        provider?: string | null;
        promptTokens?: number;
        completionTokens?: number;
        totalTokens?: number;
        cachedTokens?: number;
        cost?: {
          totalUsd?: number;
          rates?: {
            promptPer1M?: number;
            completionPer1M?: number;
          };
        };
      }
    | undefined;
  if (!usage) return undefined;
  const rates = usage.cost?.rates;
  return {
    model: usage.model,
    provider: usage.provider,
    promptTokens: usage.promptTokens ?? 0,
    cachedTokens: usage.cachedTokens,
    completionTokens: usage.completionTokens ?? 0,
    totalTokens: usage.totalTokens ?? 0,
    costUsd: usage.cost?.totalUsd,
    pricingRates:
      rates?.promptPer1M != null && rates?.completionPer1M != null
        ? {
            promptPer1M: rates.promptPer1M,
            completionPer1M: rates.completionPer1M,
          }
        : undefined,
  };
}

export async function verifyApplyOutcome(
  params: {
    pageText: string;
    jobTitle?: string;
    /** Number of form controls still visible on the page. Used to disambiguate empty page text. */
    controlCount?: number;
  },
  signal?: AbortSignal,
): Promise<ApplyVerifyResult> {
  const text = (params.pageText || "").slice(0, 6000);
  const controlInfo =
    params.controlCount != null
      ? `Control count on page: ${params.controlCount} (0 = form gone, >0 = form still present)`
      : "";
  const response = await chatCompletion({
    system: VERIFY_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          params.jobTitle ? `Job: ${params.jobTitle}` : "",
          controlInfo,
          "Page text after clicking Submit:",
          "```",
          text,
          "```",
          "Return the status + reason.",
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
    responseSchema: APPLY_VERIFY_SCHEMA,
    signal,
  });

  const usage = toAiUsage(response.usage);
  const structured = response.structured as { status?: ApplyVerifyStatus; reason?: string } | undefined;
  const status = structured?.status;
  if (status === "success" || status === "needs_verification" || status === "error" || status === "incomplete") {
    return { status, reason: structured?.reason || "", usage };
  }
  return { status: "incomplete", reason: "AI verifier returned no status", usage };
}
