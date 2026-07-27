import { DEEPSEEK_MODELS } from "@nextoffer/shared/models";
import { resumeGeneratorConfigCollection } from "../db/dataStore.js";
import { defaultGeneratorConfig, stepsToPlan } from "../config/resumeGeneratorDefaults.js";
import { getFirestoreDb } from "./firebase/firebaseAdmin.js";
import { findAccountByApplierName } from "./mail/credentials.js";
import { identityFromProfile } from "../utils/identityFromProfile.js";
import { getProvider, PROVIDERS } from "./llm/llmService.js";

const cleanString = (v) => String(v ?? "").trim();

function normalizeProvider(provider) {
  return provider === "deepseek" ? "deepseek" : "openai";
}

function normalizedKey(value) {
  return cleanString(value).toLocaleLowerCase();
}

function sameValue(left, right) {
  return normalizedKey(left) === normalizedKey(right);
}

function configUpdatedAt(configRecord) {
  const value = configRecord?.updatedAt;
  const date = value?.toDate instanceof Function ? value.toDate() : value;
  const time = new Date(date || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

/**
 * A migrated account can have a later, default-only config under its display
 * name plus the real authored pipeline under the email that MongoDB used as
 * the applier key. Do not let that boilerplate record hide the authored one.
 */
export function isDefaultGeneratorPipeline(config) {
  if (!config || typeof config !== "object") return true;
  const base = defaultGeneratorConfig();
  if (cleanString(config.systemInstruction) !== cleanString(base.systemInstruction)) return false;
  if (!Array.isArray(config.steps) || config.steps.length !== base.steps.length) return false;
  return base.steps.every((defaultStep) => {
    const step = config.steps.find((candidate) =>
      candidate?.purpose === defaultStep.purpose && candidate?.kind === defaultStep.kind,
    );
    return step
      && cleanString(step.prompt) === cleanString(defaultStep.prompt)
      && cleanString(step.schema) === cleanString(defaultStep.schema);
  });
}

/** Select an authored legacy alias before a default-only display-name record. */
export function selectGeneratorConfigRecord(records, { applierName, profileId } = {}) {
  const unique = [...new Map(
    (Array.isArray(records) ? records : [])
      .filter((record) => record?.config && typeof record.config === "object")
      .map((record) => [String(record._id || record.id || `${record.applierName}:${configUpdatedAt(record)}`), record]),
  ).values()];
  if (!unique.length) return null;

  const newest = (items) => [...items].sort((left, right) => configUpdatedAt(right) - configUpdatedAt(left))[0] || null;
  const exact = unique.filter((record) => sameValue(record.applierName, applierName));
  const exactAuthored = exact.filter((record) => !isDefaultGeneratorPipeline(record.config));
  if (exactAuthored.length) return { record: newest(exactAuthored), source: "applier-name" };

  const authoredAliases = unique.filter((record) => !isDefaultGeneratorPipeline(record.config));
  if (authoredAliases.length) {
    const profileMatch = profileId == null
      ? []
      : authoredAliases.filter((record) => String(record.profileId || "") === String(profileId));
    return { record: newest(profileMatch.length ? profileMatch : authoredAliases), source: "legacy-alias" };
  }

  if (exact.length) return { record: newest(exact), source: "applier-name" };
  const profileMatch = profileId == null
    ? []
    : unique.filter((record) => String(record.profileId || "") === String(profileId));
  return { record: newest(profileMatch.length ? profileMatch : unique), source: profileMatch.length ? "profile-id" : "legacy-alias" };
}

function generatorConfigAliases(applierName, account) {
  return [...new Set([
    cleanString(applierName),
    cleanString(account?.name),
    cleanString(account?.email),
    cleanString(account?.autoBidProfile?.email),
  ].filter(Boolean))];
}

async function readGeneratorConfigRecords(aliases, profileId) {
  // Migrated documents retain their original Mongo ObjectId while new saves use
  // deterministic ids. The adapter's unique-key fast path can only see the
  // latter, so query Firestore directly here to include both representations.
  const collection = getFirestoreDb().collection("resume_generator_config");
  const queries = [];
  if (aliases.length) queries.push(collection.where("applierName", "in", aliases).get());
  if (profileId != null) queries.push(collection.where("profileId", "==", String(profileId)).get());
  const snapshots = await Promise.all(queries);
  const records = new Map();
  for (const snapshot of snapshots) {
    for (const document of snapshot.docs) {
      records.set(document.id, { _id: document.id, ...document.data() });
    }
  }
  return [...records.values()];
}

/**
 * Resolve a config using the display name, the stable profile id, and legacy
 * email aliases preserved by the MongoDB-to-Firestore migration.
 */
export async function loadGeneratorConfigRecord(applierName) {
  const name = cleanString(applierName);
  if (!name || !resumeGeneratorConfigCollection) return null;

  const account = await findAccountByApplierName(name).catch(() => null);
  const aliases = generatorConfigAliases(name, account);
  const profileId = account?._id ?? account?.profileId ?? null;
  const records = await readGeneratorConfigRecords(aliases, profileId);
  return selectGeneratorConfigRecord(records, {
    applierName: account?.name || name,
    profileId,
  });
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

/** Merge a partial saved Firestore config onto defaults with validated provider/model. */
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
  const resolved = await loadGeneratorConfigRecord(applierName);
  return mergeStoredConfig(resolved?.record?.config);
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

  // For structured catalog jobs, drop steps the user marked "skip for structured
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
