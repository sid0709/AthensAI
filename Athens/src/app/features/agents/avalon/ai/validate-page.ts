import { chatCompletion } from "./client";
import type { JsonSchemaDefinition } from "./chat-types";
import { toAiUsage, type AiUsage } from "./verify-apply";

/**
 * AI check that an opened job link is actually a live application form worth
 * filling — before we spend a scan/analyze/fill on it. Language-based only (reads
 * the page text + control count); no vendor/site strings, per Guide.md.
 */

export type PageValidityKind =
  | "application_form" // valid — a fillable job application form
  | "expired" // posting closed / no longer accepting applications
  | "not_found" // 404 / page does not exist
  | "error" // page failed to load / error page
  | "not_a_form"; // a real page but not an application form (job description only, login wall, etc.)

const VALIDATE_SYSTEM_PROMPT = [
  "You decide whether an opened URL is part of an ACTIVE job-application flow worth continuing.",
  "You are given the page's visible text, its title, and how many actionable controls were discovered.",
  "Classify into exactly one kind:",
  "- application_form: ANY page in an open application flow, including:",
  "  (a) a fillable form with name/email/résumé/etc., OR",
  "  (b) a job posting / intake page whose next step is an in-page Apply / Submit / Continue / Next",
  "      control that advances toward the application (even when text fields are not visible yet).",
  "  Do NOT reject a page merely because the user must click Apply first — that IS the application flow.",
  "- expired: the posting is closed / no longer accepting applications / position filled.",
  "- not_found: 404 / page or job does not exist / invalid link.",
  "- error: the page failed to load, shows an error, or is blank with no meaningful content.",
  "- not_a_form: a valid page but NOT part of this job's application (e.g. a multi-job board listing,",
  "  careers home page, unrelated article, login/SSO wall with no apply path on this page).",
  "Prominent Apply / Apply for / Submit / Continue / Next text with a job title strongly implies application_form.",
  "A control count of 0 with 'not found', 'no longer', 'closed', 'expired' text implies expired/not_found.",
  "Judge only from the given text + control count.",
].join("\n");

export const PAGE_VALIDITY_SCHEMA: JsonSchemaDefinition = {
  name: "page_validity",
  description: "Whether an opened URL is a fillable job application form.",
  strict: true,
  schema: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        enum: ["application_form", "expired", "not_found", "error", "not_a_form"],
      },
      reason: { type: "string", description: "One short sentence citing the page text/title that decided it." },
    },
    required: ["kind", "reason"],
    additionalProperties: false,
  },
};

export interface PageValidityResult {
  kind: PageValidityKind;
  valid: boolean;
  reason: string;
  usage?: AiUsage;
}

export async function validateJobPage(
  params: {
    text: string;
    title?: string;
    url?: string;
    fieldCount: number;
    controlCount?: number;
  },
  signal?: AbortSignal,
): Promise<PageValidityResult> {
  const text = (params.text || "").slice(0, 5000);
  const response = await chatCompletion({
    system: VALIDATE_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          params.title ? `Title: ${params.title}` : "",
          params.url ? `URL: ${params.url}` : "",
          `Fillable form fields discovered: ${params.fieldCount}`,
          params.controlCount != null ? `Visible controls: ${params.controlCount}` : "",
          "Page text:",
          "```",
          text,
          "```",
          "Return kind + reason.",
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
    responseSchema: PAGE_VALIDITY_SCHEMA,
    signal,
  });

  const usage = toAiUsage(response.usage);
  const structured = response.structured as { kind?: PageValidityKind; reason?: string } | undefined;
  const kind = structured?.kind;
  const valid = kind === "application_form";
  if (kind) return { kind, valid, reason: structured?.reason || "", usage };
  // If the classifier fails but we clearly saw form fields, don't block the apply.
  return {
    kind: params.fieldCount > 0 ? "application_form" : "error",
    valid: params.fieldCount > 0,
    reason: "Validity classifier returned no result",
    usage,
  };
}
