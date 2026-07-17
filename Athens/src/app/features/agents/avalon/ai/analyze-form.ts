import { chatCompletion } from "./client";
import {
  FORM_ACTION_PLAN_SYSTEM_PROMPT,
  buildAnalysisUserMessage,
  flattenActionableTree,
  partitionFields,
  skipActionPlanEntry,
} from "./prompt";
import { FORM_ACTION_PLAN_SCHEMA } from "./schema";
import type { AnalyzeFormOptions, FieldAction, FieldActionPlan, FormAnalysisResult } from "./types";

const VALID_ACTIONS = new Set<FieldAction>([
  "Click",
  "Typing",
  "SelectOption",
  "FileUpload",
  "Check",
  "Uncheck",
]);

function parseActionPlan(
  raw: Record<string, unknown>,
  fieldById?: Map<string, { controlType: string }>,
): FieldActionPlan | null {
  const id = typeof raw.id === "string" ? raw.id : "";
  const action = raw.action;
  const shouldSkip = raw.shouldSkip;
  const value = typeof raw.value === "string" ? raw.value : "";
  if (!id || !VALID_ACTIONS.has(action as FieldAction)) return null;
  if (shouldSkip !== "Yes" && shouldSkip !== "No") return null;
  if (!value) return null;

  let resolvedAction = action as FieldAction;
  const field = fieldById?.get(id);
  if (resolvedAction === "SelectOption" && field && field.controlType !== "select") {
    resolvedAction = "Typing";
  }
  // A free-text field is only ever filled by typing — a Click/Check on a
  // text/textarea is a model slip; coerce it (generic control-type rule).
  if ((field?.controlType === "text" || field?.controlType === "textarea") && resolvedAction !== "Typing") {
    resolvedAction = "Typing";
  }

  return {
    id,
    action: resolvedAction,
    shouldSkip,
    value: shouldSkip === "Yes" ? "N/A" : value,
    notes: typeof raw.notes === "string" ? raw.notes : undefined,
  };
}

export async function analyzeFormFields(
  options: AnalyzeFormOptions,
  signal?: AbortSignal,
): Promise<FormAnalysisResult> {
  const allFields = flattenActionableTree(options.tree);
  if (allFields.length === 0) {
    return { fields: [] };
  }

  const { actionable, skippable } = partitionFields(allFields);
  const localSkips = skippable.map(skipActionPlanEntry);

  let parsed: FieldActionPlan[] = [...localSkips];
  let usage: FormAnalysisResult["usage"];

  if (actionable.length > 0) {
    const response = await chatCompletion({
      system: FORM_ACTION_PLAN_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: buildAnalysisUserMessage(actionable, options.applicantContext, skippable.length),
        },
      ],
      responseSchema: FORM_ACTION_PLAN_SCHEMA,
      signal,
    });

    const structured = response.structured as { fields?: Array<Record<string, unknown>> } | undefined;
    const fieldById = new Map(actionable.map((f) => [f.id, { controlType: f.controlType }]));
    parsed = [
      ...localSkips,
      ...(structured?.fields
        ?.map((raw) => parseActionPlan(raw, fieldById))
        .filter((f): f is FieldActionPlan => f !== null) ?? []),
    ];

    usage = response.usage
      ? {
          model: response.billedModel ?? response.model,
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
      : undefined;
  }

  return { fields: parsed, usage };
}

export { flattenActionableTree, isSkippableField, partitionFields } from "./prompt";
