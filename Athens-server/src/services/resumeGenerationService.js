import { DEEPSEEK_MODELS } from "@nextoffer/shared/models";
import { resumeGeneratorConfigCollection } from "../db/mongo.js";
import { defaultGeneratorConfig, stepsToPlan } from "../config/resumeGeneratorDefaults.js";
import { identityFromProfile } from "../utils/identityFromProfile.js";
import { getProvider, PROVIDERS } from "./llm/llmService.js";

const cleanString = (v) => String(v ?? "").trim();

function normalizeProvider(provider) {
  return provider === "deepseek" ? "deepseek" : "openai";
}

/**
 * Pick a model that belongs to the selected provider. Uses the saved model when
 * valid; otherwise the provider's first known model (never a hardcoded override).
 */
export function resolveResumeModel(provider, savedModel) {
  const providerId = normalizeProvider(provider);
  const model = cleanString(savedModel);
  const providerDef = getProvider(providerId);
  const allowed = Array.isArray(providerDef.models) ? providerDef.models : null;

  if (providerId === "deepseek") {
    if (model && allowed?.includes(model)) return model;
    return allowed?.[0] || DEEPSEEK_MODELS[0];
  }

  // OpenAI: keep any non-DeepSeek saved model (live catalog is open-ended).
  if (model && !model.startsWith("deepseek-")) return model;
  return cleanString(defaultGeneratorConfig().model) || "gpt-5-nano";
}

/** Merge a partial saved config (MongoDB) onto defaults with validated provider/model. */
export function mergeStoredConfig(saved) {
  const base = defaultGeneratorConfig();
  if (!saved || typeof saved !== "object") return base;
  const provider = normalizeProvider(saved.provider);
  return {
    ...base,
    ...saved,
    provider,
    model: resolveResumeModel(provider, saved.model ?? base.model),
    reasoningEffort: saved.reasoningEffort ?? base.reasoningEffort,
    templateId: saved.templateId ?? base.templateId,
    theme: { ...base.theme, ...(saved.theme ?? {}) },
    layout: Array.isArray(saved.layout) && saved.layout.length ? saved.layout : base.layout,
    systemInstruction: saved.systemInstruction ?? base.systemInstruction,
    jobDescription: saved.jobDescription ?? base.jobDescription,
    steps: Array.isArray(saved.steps) && saved.steps.length ? saved.steps : base.steps,
  };
}

/** Load the saved Resume Generator (Editor) config for an applier. */
export async function loadGeneratorConfig(applierName) {
  const name = cleanString(applierName);
  if (!name || !resumeGeneratorConfigCollection) return defaultGeneratorConfig();
  const doc = await resumeGeneratorConfigCollection.findOne({ applierName: name });
  return mergeStoredConfig(doc?.config);
}

/**
 * Build the generation request body from saved Editor config — mirrors the Resume
 * Editor payload in useResumeEditor.ts. Only jobDescription (and optional job id)
 * vary per agent run.
 */
export function buildGenerationRequestFromSavedConfig({
  applierName,
  jobDescription,
  savedConfig,
  identity,
  generateParentJobId,
  structuredJob = false,
}) {
  const jd = cleanString(jobDescription);
  const config = mergeStoredConfig(savedConfig);
  const provider = normalizeProvider(config.provider);
  const model = resolveResumeModel(provider, config.model);
  const reasoningEffort =
    config.reasoningEffort === "default" || !config.reasoningEffort ? undefined : config.reasoningEffort;

  // For structured (MongoDB) jobs, drop steps the user marked "skip for structured
  // jobs" — e.g. the AI skill-fetch step, since those skills come from the job doc.
  const steps = structuredJob
    ? (Array.isArray(config.steps) ? config.steps : []).filter((s) => !s?.skipForStructuredJobs)
    : config.steps;

  return {
    applierName: cleanString(applierName),
    provider: PROVIDERS[provider] ? provider : "openai",
    model,
    reasoningEffort,
    templateId: config.templateId,
    template: config.templateId ? { layout: config.templateId } : config.template,
    theme: config.theme,
    layout: config.layout,
    systemInstruction: config.systemInstruction,
    jobDescription: jd,
    identity: identity ?? identityFromProfile({}),
    steps: stepsToPlan(steps),
    generateParentJobId: generateParentJobId ? cleanString(generateParentJobId) : undefined,
  };
}
