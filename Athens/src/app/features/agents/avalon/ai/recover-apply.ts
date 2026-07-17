import type { ActionableTree } from "@avalon/shared";
import { chatCompletion } from "./client";
import type { JsonSchemaDefinition } from "./chat-types";
import { flattenActionableTree } from "./prompt";

/**
 * Self-healing recovery for a failed apply. The declarative first-pass fill stays
 * vendor-neutral; when it fails, we hand the AI the LIVE DOM + the previous plan +
 * the failure and let it author a JavaScript recovery snippet. Per Guide.md, this
 * recovery path is allowed (and recommended) to use `execute_script` — the AI reads
 * the live DOM at runtime rather than us hardcoding any site/label/vendor branch.
 */

const RECOVERY_SYSTEM_PROMPT = [
  "You are a self-healing job-application recovery agent.",
  "A declarative auto-fill just ran on a job application page and did NOT confirm submission.",
  "You are given the live DOM (a re-scanned actionable tree + the page's innerText), the",
  "previous fill plan, and the per-step results/errors. Author ONE JavaScript snippet that",
  "corrects the remaining problem and, when appropriate, submits the form.",
  "",
  "The snippet is executed as `new Function(source)()` INSIDE the page (content-script world,",
  "full DOM access, same origin). Rules for the snippet:",
  "- It is a FUNCTION BODY: use statements and end with `return <summary object>`.",
  "- If you need to await (waiting for an option list, a re-render, a network settle), wrap your",
  "  logic as `return (async () => { /* ... await ... */ return summary; })();` — the runner awaits it.",
  "- Read the LIVE DOM to locate controls (querySelector, textContent, labels, aria-*). Do NOT",
  "  hardcode any site name, vendor CSS class, or specific label string — derive selectors from",
  "  the DOM you are given so the same code works on any site.",
  "- Fill any still-empty REQUIRED field with a real value from the applicant profile, fix any",
  "  field flagged invalid, dismiss non-blocking overlays, and answer required single-select/",
  "  checkbox questions.",
  "- React/controlled inputs ignore a plain `el.value = x`. Set the value through the native",
  "  setter so the framework registers it, then dispatch input + change, e.g.:",
  "    const set=(el,v)=>{const p=el instanceof HTMLTextAreaElement?HTMLTextAreaElement:HTMLInputElement;",
  "    Object.getOwnPropertyDescriptor(p.prototype,'value').set.call(el,v);",
  "    el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));};",
  "  Locate a field's input structurally (its label/container text → the nearby input/textarea), since",
  "  some inputs have no <label> — their label may be sibling/container text or a placeholder.",
  "- If you just uploaded or an async parse is in flight, await a brief settle before filling so a",
  "  re-render does not wipe your values.",
  "- If a verification/one-time code is required and a code is provided to you below, enter it. When",
  "  the code is split across several single-character inputs, set ONE character per input in order",
  "  (native value setter + input/change on each); otherwise put the whole code in the single field.",
  "  Then click the submit/verify control.",
  "- After fixing the remaining issues, click the page's Submit / Apply / Continue / Next control",
  "  (find it by role/type/label from the live DOM) UNLESS you set done=false because more info is",
  "  needed (e.g. an unfulfilled verification).",
  "- You CANNOT set <input type=file>.files from this world; skip file inputs (résumé upload is",
  "  handled separately).",
  "- Return a concise summary object, e.g. `return { filled: [...], clickedSubmit: true, note: '...' }`.",
  "",
  "In `reasoning`, briefly explain what failed and what your snippet does. Set `done=true` when the",
  "snippet should complete the application, `false` when it only partially advances (loop continues).",
].join("\n");

export const RECOVERY_SCRIPT_SCHEMA: JsonSchemaDefinition = {
  name: "apply_recovery",
  description: "A JavaScript recovery snippet plus reasoning to fix a failed job application.",
  strict: true,
  schema: {
    type: "object",
    properties: {
      reasoning: {
        type: "string",
        description: "Why the apply failed and what the recovery snippet does.",
      },
      script: {
        type: "string",
        description:
          "Function body run via new Function(source)() in the page. Ends with `return <summary>`; wrap async work in `return (async()=>{...})();`.",
      },
      done: {
        type: "boolean",
        description: "true if this snippet should complete the application; false if only partial progress.",
      },
    },
    required: ["reasoning", "script", "done"],
    additionalProperties: false,
  },
};

export interface RecoveryContext {
  jobTitle: string;
  pageUrl: string;
  /** Page innerText after the failed submit (truncated). */
  pageText: string;
  /** Classifier reason the apply was not confirmed. */
  outcomeReason: string;
  /** Steps of the plan we just tried. */
  previousPlan: Array<{ id: string; label: string; op: string; value?: string }>;
  /** Per-step results from the last run (ok/error). */
  stepResults: Array<{ id: string; label: string; op: string; ok: boolean; error?: string }>;
  /** Freshly re-scanned actionable tree. */
  tree: ActionableTree;
  attempt: number;
  maxAttempts: number;
  applicantContext?: string;
  /** A one-time / verification code fetched from email, when the page asked for one. */
  otpCode?: string | null;
}

export interface RecoveryResult {
  reasoning: string;
  script: string;
  done: boolean;
  usage?: {
    model?: string | null;
    provider?: string | null;
    promptTokens: number;
    cachedTokens?: number;
    completionTokens: number;
    totalTokens: number;
    cost?: {
      totalUsd: number;
      currency: string;
      rates?: {
        promptPer1M: number;
        completionPer1M: number;
      };
    };
  };
}

function buildRecoveryUserMessage(ctx: RecoveryContext): string {
  const fields = flattenActionableTree(ctx.tree).map((f) => ({
    id: f.id,
    groupContext: f.groupContext,
    label: f.label,
    required: f.required,
    controlType: f.controlType,
    controlTag: f.controlTag,
    ...(f.options?.length ? { options: f.options.slice(0, 30) } : {}),
  }));

  const parts = [
    `Attempt ${ctx.attempt} of ${ctx.maxAttempts}. Job: ${ctx.jobTitle} — ${ctx.pageUrl}`,
    `Why not confirmed: ${ctx.outcomeReason}`,
    ctx.otpCode ? `Verification code available (from email): ${ctx.otpCode}` : "",
    "",
    "Page innerText (truncated):",
    "```",
    (ctx.pageText || "").slice(0, 4000),
    "```",
    "",
    "Previous plan steps we ran:",
    "```json",
    JSON.stringify(ctx.previousPlan.slice(0, 80), null, 2),
    "```",
    "",
    "Per-step results (failures matter most):",
    "```json",
    JSON.stringify(ctx.stepResults.filter((r) => !r.ok).slice(0, 40), null, 2),
    "```",
    "",
    "Live re-scanned fields on the page now:",
    "```json",
    JSON.stringify({ fieldCount: fields.length, fields }, null, 2),
    "```",
  ].filter(Boolean);

  if (ctx.applicantContext?.trim()) {
    parts.push("", "Applicant profile:", "```json", ctx.applicantContext.trim(), "```");
  }

  parts.push(
    "",
    "Author the recovery snippet now. Prefer the smallest change that lets the application submit.",
  );

  return parts.join("\n");
}

export async function generateRecoveryScript(
  ctx: RecoveryContext,
  signal?: AbortSignal,
): Promise<RecoveryResult> {
  const response = await chatCompletion({
    system: RECOVERY_SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildRecoveryUserMessage(ctx) }],
    responseSchema: RECOVERY_SCRIPT_SCHEMA,
    signal,
  });

  const structured = response.structured as
    | { reasoning?: string; script?: string; done?: boolean }
    | undefined;
  const script = typeof structured?.script === "string" ? structured.script : "";
  if (!script.trim()) throw new Error("Recovery model returned no script");

  return {
    reasoning: typeof structured?.reasoning === "string" ? structured.reasoning : "",
    script,
    done: structured?.done !== false,
    usage: response.usage
      ? {
          model: response.model,
          provider: response.provider,
          promptTokens: response.usage.promptTokens,
          cachedTokens: response.usage.cachedTokens,
          completionTokens: response.usage.completionTokens,
          totalTokens: response.usage.totalTokens,
          cost: response.usage.cost
            ? {
                totalUsd: response.usage.cost.totalUsd,
                currency: response.usage.cost.currency,
                rates: response.usage.cost.rates,
              }
            : undefined,
        }
      : undefined,
  };
}
