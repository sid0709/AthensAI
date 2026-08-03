import { DocumentId } from "@nextoffer/shared/document-id";
import { createHash, randomUUID } from "node:crypto";
import {
  accountInfoCollection,
  backgroundTaskInputsCollection,
  resumeGeneratorConfigCollection,
  resumeGenerationsCollection,
} from "../db/dataStore.js";
import { syncGeneratedResumeAfterRun, deleteGenerationRun } from "../services/generatedResumeService.js";
import { renderAgentResumePdf } from "../services/agentResumePdf.js";
import {
  PROVIDERS,
  getProvider,
  chatCompletion,
  listModels,
  verifyKey,
  addUsage,
  EMPTY_USAGE,
  resolveDefaultModel,
} from "../services/llm/llmService.js";
import { loadDecryptedAutoBidProfile } from "../services/autoBidProfileSecrets.js";
import { loadGeneratorConfigRecord } from "../services/resumeGenerationService.js";
import { migrateGeneratorConfig } from "../services/resumeGeneratorConfigSchema.js";
import {
  analyzeResumeCoverage as analyzeResumeCoverageLedger,
  auditResumeCoverage,
  normalizeResumeCoverageContract,
  resumeCoveragePrompt,
  resumeCoverageRepairPrompt,
} from "../services/resumeCoverageService.js";
import { isBetaTier } from "../lib/betaTier.js";
import {
  createBackgroundTask,
  getBackgroundTask,
} from "../services/backgroundTasks/taskStore.js";
import {
  BACKGROUND_TASK_TYPES,
  TERMINAL_TASK_STATUSES,
  publicTaskSnapshot,
} from "../services/backgroundTasks/taskTypes.js";
import { firestoreMutationLimiter } from "../services/backgroundTasks/resourceLimits.js";
import { renderResumePdfInBackgroundLane } from "../services/backgroundTasks/pdfLane.js";
import { readAgentDraftPath } from "../services/agentResumeDraftService.js";
import {
  TITLE_POLICY_VERSION,
  appendExperienceTitlePolicy,
  applyTitlePolicyToSections,
  computeTitlePolicyFingerprint,
  sourceCareers,
} from "../services/resumeCareerTitlePolicy.js";

const cleanString = (v) => String(v ?? "").trim();
const BACKGROUND_INPUT_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;

function resumeTaskIdentity(req, applierName) {
  const name = cleanString(applierName || req.authProfile?.profileName || req.authProfile?.applierName);
  return {
    applierName: name,
    profileId: cleanString(req.authProfile?.profileId || req.body?.profileId)
      || name.toLocaleLowerCase("en-US"),
    ownerUid: cleanString(req.auth?.uid) || null,
  };
}

function persistedGenerationRequest(body, applierName) {
  return {
    applierName,
    provider: body.provider ?? null,
    model: body.model ?? null,
    reasoningEffort: body.reasoningEffort ?? null,
    dynamicCareerTitles: body.dynamicCareerTitles === true,
    templateId: body.templateId ?? null,
    template: body.template ?? null,
    theme: body.theme ?? null,
    layout: body.layout ?? null,
    identity: body.identity ?? null,
    identitySyncedAt: body.identitySyncedAt ?? null,
    systemInstruction: body.systemInstruction ?? null,
    jobDescription: body.jobDescription ?? null,
    steps: Array.isArray(body.steps) ? body.steps : [],
    coverage: body.coverage && typeof body.coverage === "object" ? body.coverage : null,
  };
}

async function enqueueStoredResumeGeneration(req, body) {
  if (!backgroundTaskInputsCollection) {
    throw Object.assign(new Error("Database not ready"), { status: 503 });
  }
  const identity = resumeTaskIdentity(req, body.applierName);
  if (!identity.applierName) throw Object.assign(new Error("applierName is required"), { status: 400 });
  if (!Array.isArray(body.steps) || !body.steps.length) {
    throw Object.assign(new Error("steps are required"), { status: 400 });
  }
  const requestId = cleanString(body.requestId || req.body?.requestId) || randomUUID();
  const inputId = createHash("sha256")
    .update(`${identity.profileId}\0${requestId}\0resume-generation`)
    .digest("hex");
  const createdAt = new Date();
  const input = {
    _id: inputId,
    kind: BACKGROUND_TASK_TYPES.RESUME_GENERATION,
    requestId,
    profileId: identity.profileId,
    applierName: identity.applierName,
    ownerUid: identity.ownerUid,
    status: "queued",
    request: persistedGenerationRequest(body, identity.applierName),
    partialSections: {},
    result: null,
    error: null,
    createdAt,
    updatedAt: createdAt,
    expiresAt: new Date(createdAt.getTime() + BACKGROUND_INPUT_RETENTION_MS),
  };
  await backgroundTaskInputsCollection.updateOne(
    { _id: inputId },
    { $setOnInsert: input },
    { upsert: true },
  );
  try {
    const queued = await createBackgroundTask({
      requestId,
      type: BACKGROUND_TASK_TYPES.RESUME_GENERATION,
      ...identity,
      payload: { requestRecordIds: [inputId], deferPdf: true },
      progress: { total: 1, operation: "editor_generation", inputId },
    });
    return { ...queued, inputId };
  } catch (error) {
    await backgroundTaskInputsCollection.updateOne(
      { _id: inputId, status: "queued" },
      { $set: { status: "failed", error: error.message, updatedAt: new Date() } },
    ).catch(() => undefined);
    throw error;
  }
}

async function enqueueAgentResumeGeneration(req, body) {
  const identity = resumeTaskIdentity(req, body.applierName);
  const jobId = cleanString(body.jobId);
  if (!identity.applierName) throw Object.assign(new Error("applierName is required"), { status: 400 });
  if (!jobId) throw Object.assign(new Error("jobId is required"), { status: 400 });
  return createBackgroundTask({
    requestId: cleanString(body.requestId) || randomUUID(),
    type: BACKGROUND_TASK_TYPES.RESUME_GENERATION,
    ...identity,
    payload: {
      jobIds: [jobId],
      forceRegenerate: body.forceRegenerate === true,
      deferPdf: body.deferPdf === true,
    },
    progress: { total: 1, operation: "agent_job_resume", jobId },
  });
}

async function enqueueAgentResumeRemoval(req, body) {
  const identity = resumeTaskIdentity(req, body.applierName);
  const jobIds = Array.isArray(body.jobIds)
    ? [...new Set(body.jobIds.map(cleanString).filter(Boolean))]
    : [];
  if (!identity.applierName) throw Object.assign(new Error("applierName is required"), { status: 400 });
  if (!jobIds.length) throw Object.assign(new Error("jobIds is required"), { status: 400 });
  return createBackgroundTask({
    requestId: cleanString(body.requestId) || randomUUID(),
    type: BACKGROUND_TASK_TYPES.RESUME_REMOVAL,
    ...identity,
    payload: { recordIds: jobIds },
    progress: { total: jobIds.length, operation: "agent_resume_removal" },
  });
}

async function enqueueResumeIdentityRefresh(req, body) {
  const identity = resumeTaskIdentity(req, body.applierName);
  if (!identity.applierName) throw Object.assign(new Error("applierName is required"), { status: 400 });
  return createBackgroundTask({
    requestId: cleanString(body.requestId) || randomUUID(),
    type: BACKGROUND_TASK_TYPES.RESUME_IDENTITY_REFRESH,
    ...identity,
    payload: { forceAll: body.forceAll === true },
    progress: { total: null, operation: "resume_identity_refresh" },
  });
}

function bindRequestAbort(req, res, message = "Client disconnected") {
  const controller = new AbortController();
  const abort = () => {
    if (controller.signal.aborted) return;
    controller.abort(Object.assign(new Error(message), { name: "AbortError" }));
  };
  const onClose = () => {
    if (!res.writableEnded) abort();
  };
  function cleanup() {
    req.off("aborted", abort);
    res.off("close", onClose);
    res.off("finish", cleanup);
  }
  req.once("aborted", abort);
  res.once("close", onClose);
  res.once("finish", cleanup);
  return {
    signal: controller.signal,
    cleanup,
  };
}

function isAbortError(err) {
  return err?.name === "AbortError" || err?.code === "ABORT_ERR";
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : Object.assign(new Error("Operation cancelled"), { name: "AbortError" });
}

/** Resolve an applier's autoBidProfile (exact, then case-insensitive). */
async function findProfile(applierNameRaw) {
  return loadDecryptedAutoBidProfile(applierNameRaw);
}

function apiKeyFor(profile, providerId) {
  const provider = getProvider(providerId);
  return String(profile?.[provider.keyField] || "").trim();
}

/** GET /personal/llm-models?provider=&applierName= — model list per provider. */
export async function getLlmModels(req, res) {
  try {
    const providerId = PROVIDERS[req.query?.provider] ? req.query.provider : "openai";
    const provider = getProvider(providerId);
    // Fixed-catalog providers (DeepSeek) don't need a key to list models.
    if (Array.isArray(provider.models)) {
      return res.json({ success: true, provider: providerId, models: provider.models });
    }
    const profile = await findProfile(req.query?.applierName);
    const apiKey = apiKeyFor(profile, providerId);
    if (!apiKey) {
      return res.json({ success: true, provider: providerId, models: [], error: `No ${provider.label} API key in profile.` });
    }
    const models = await listModels({ provider: providerId, apiKey, force: req.query?.force === "1" });
    return res.json({ success: true, provider: providerId, models });
  } catch (err) {
    // A bad/expired key is an expected, recoverable condition — warn, don't spam
    // a full stack trace, and let the UI fall back to its default model list.
    console.warn(`GET /api/personal/llm-models failed: ${err.message}`);
    return res.status(200).json({ success: false, models: [], error: err.message });
  }
}

/**
 * Parse a JSON object from a model reply, tolerating Markdown code fences and
 * stray prose (Claude often wraps JSON in ```json … ```).
 */
function parseJsonLoose(text) {
  const raw = String(text ?? "").trim();
  try {
    return JSON.parse(raw);
  } catch {
    /* fall through */
  }
  const fenced = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try {
    return JSON.parse(fenced);
  } catch {
    /* fall through */
  }
  const first = fenced.indexOf("{");
  const last = fenced.lastIndexOf("}");
  if (first !== -1 && last > first) {
    return JSON.parse(fenced.slice(first, last + 1));
  }
  throw new Error("No JSON object found in model response.");
}

const PURPOSES = new Set(["summary", "skills", "experience", "education"]);

// Format one career entry as a natural sentence for {companyN} tokens:
// "Senior Software Engineer at McGrow Hill (2026.2 – Present) — E-learning platform"
export function formatCompanyToken(c) {
  const title = cleanString(c?.title);
  const company = cleanString(c?.company);
  const period = cleanString(c?.period);
  const description = cleanString(c?.description);

  let head = "";
  if (title && company) head = `${title} at ${company}`;
  else head = title || company;

  if (period && head) head = `${head} (${period})`;
  else if (period) head = period;

  return description && head ? `${head} — ${description}` : head || description;
}

// Resolve the reference tokens a prompt may use into concrete strings, derived
// from the candidate profile + JD. `{career}` is a newline-joined summary of all
// roles; `{companyN}` is a natural-sentence summary of the Nth career (N is
// 1-based, by order stored on the profile). `{job_skills}` are the skills
// already extracted for a structured catalog job — empty for free-text generation.
export function buildTokenMap(identity, jobDescription, jobSkills) {
  const careers = Array.isArray(identity?.careers) ? identity.careers : [];
  const field = (v) => cleanString(v);
  const skills = Array.isArray(jobSkills) ? jobSkills.map(field).filter(Boolean) : [];
  const map = {
    job_description: cleanString(jobDescription),
    job_skills: skills.join(", "),
    career: careers
      .map((c) => {
        const parts = [field(c?.title), field(c?.company), field(c?.period)].filter(Boolean);
        const description = field(c?.description);
        return description ? `${parts.join(" | ")} — ${description}` : parts.join(" | ");
      })
      .filter(Boolean)
      .join("\n"),
  };
  careers.forEach((c, i) => {
    map[`company${i + 1}`] = formatCompanyToken(c);
  });
  return map;
}

function buildContextBlock(identity) {
  // Stable prefix (kept identical across steps) so the prompt cache covers it.
  return `CANDIDATE PROFILE — these are authoritative facts. Do not invent employers, dates, schools, or credentials.\n\n${JSON.stringify(
    identity ?? {},
    null,
    2,
  )}`;
}

/** Resolve account_info.tier for an applier (exact, then case-insensitive). Never trust client. */
async function resolveAccountTier(applierNameRaw) {
  const name = cleanString(applierNameRaw);
  if (!name || !accountInfoCollection) return null;
  let acc = await accountInfoCollection.findOne({ name }, { projection: { tier: 1 } });
  if (!acc) {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    acc = await accountInfoCollection.findOne(
      { name: { $regex: new RegExp(`^${esc}$`, "i") } },
      { projection: { tier: 1 } },
    );
  }
  return acc?.tier ?? null;
}

// Validate + resolve a generation request. Returns { ok, ... } or { ok:false, status, error }.
// Exported so the auto-bid agent path (agentResumeGenService) runs the SAME core
// as the Editor — one implementation, no drift.
export async function prepareGeneration(body) {
  const steps = Array.isArray(body.steps) ? body.steps : [];
  if (!steps.length) return { ok: false, status: 400, error: "steps are required" };

  // Provider + model always come from the profile's default (Settings → Profile),
  // never from the request — there is no per-generation model picker anymore.
  const [profile, accountTier] = await Promise.all([
    findProfile(body.applierName),
    resolveAccountTier(body.applierName),
  ]);
  const { provider: providerId, apiKey, model } = resolveDefaultModel(profile);
  if (!apiKey) {
    return { ok: false, status: 400, error: `No ${getProvider(providerId).label} API key configured. Add it and set a default model in Settings → Profile.` };
  }
  if (!model) {
    return { ok: false, status: 400, error: "No default model configured. Set one in Settings → Profile." };
  }

  // Exactly one final step per purpose that appears.
  const finalsByPurpose = {};
  for (const s of steps) {
    if (s?.kind === "final" && PURPOSES.has(s.purpose)) finalsByPurpose[s.purpose] = (finalsByPurpose[s.purpose] || 0) + 1;
  }
  const bad = Object.entries(finalsByPurpose).find(([, n]) => n !== 1);
  if (bad) return { ok: false, status: 400, error: `${bad[0]} must have exactly one final step (found ${bad[1]}).` };

  // Tier remains server-resolved metadata. Dynamic titles are a saved generator
  // preference available to every tier and are enabled only by an explicit boolean.
  const isBeta = isBetaTier(accountTier);
  const dynamicCareerTitles = body.dynamicCareerTitles === true;
  const coverageContract = normalizeResumeCoverageContract(body.coverage);
  if (coverageContract?.unresolved?.length) {
    return {
      ok: false,
      status: 409,
      error: `Review ${coverageContract.unresolved.length} unresolved resume skill${coverageContract.unresolved.length === 1 ? "" : "s"} before generation.`,
    };
  }

  return { ok: true, providerId, model, steps, apiKey, isBeta, dynamicCareerTitles, coverageContract };
}

/** POST /personal/resume-generator/analyze — build the named-skill coverage ledger. */
export async function analyzeResumeCoverage(req, res) {
  try {
    const body = req.body || {};
    const applierName = cleanString(body.applierName);
    const jobDescription = cleanString(body.jobDescription);
    if (!applierName) return res.status(400).json({ success: false, error: "applierName is required" });
    if (!jobDescription) return res.status(400).json({ success: false, error: "jobDescription is required" });
    const profile = await findProfile(applierName);
    const { provider: providerId, apiKey, model } = resolveDefaultModel(profile);
    if (!apiKey || !model) {
      return res.status(400).json({
        success: false,
        error: "Configure an AI API key and default model in Settings → Profile before analyzing a job description.",
      });
    }
    const identity = body.identity && typeof body.identity === "object" ? body.identity : profile ?? {};
    const result = await analyzeResumeCoverageLedger({
      providerId,
      apiKey,
      model,
      applierName,
      jobDescription,
      identity,
      aliases: body.coverage?.aliases,
      experienceRequirementThreshold: body.coverage?.experienceRequirementThreshold,
    });
    return res.json({ success: true, provider: providerId, model, ...result });
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 500;
    console.warn(`POST /api/personal/resume-generator/analyze failed (${status}): ${error.message}`);
    return res.status(status).json({ success: false, error: error.message });
  }
}

/**
 * Build independent, contiguous section chains that may run concurrently.
 * Steps inside one section retain their conversation and order. Ambiguous plans
 * (unknown purposes, a purpose that reappears later, or steps after its final)
 * return null so the caller preserves the original global sequence.
 */
export function buildParallelPurposeChains(steps) {
  if (!Array.isArray(steps) || steps.length < 2) return null;
  const chains = [];
  const seen = new Set();
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i] || {};
    if (!PURPOSES.has(step.purpose)) return null;
    let chain = chains.at(-1);
    if (!chain || chain.purpose !== step.purpose) {
      if (seen.has(step.purpose)) return null;
      seen.add(step.purpose);
      chain = { purpose: step.purpose, entries: [] };
      chains.push(chain);
    }
    chain.entries.push({ step, index: i + 1 });
  }
  if (chains.length < 2) return null;
  for (const chain of chains) {
    const finals = chain.entries.filter(({ step }) => step.kind === "final");
    if (finals.length !== 1 || chain.entries.at(-1)?.step?.kind !== "final") return null;
  }
  return chains;
}

/**
 * Runs the resume pipeline as cached per-section conversations. Independent
 * section chains run concurrently; fine-tunes within a section remain ordered.
 * Plans whose dependency shape is ambiguous retain the original global order.
 * `onStep` is invoked after every step for live progress streaming.
 */
export async function runGeneration({
  providerId,
  apiKey,
  model,
  steps,
  systemInstruction,
  identity,
  applierName,
  jobDescription,
  jobSkills,
  coverageContract,
  reasoningEffort,
  isBeta = false,
  dynamicCareerTitles = false,
  signal,
}, onStep) {
	const throwIfAborted = () => {
		if (!signal?.aborted) return;
		throw signal.reason instanceof Error
			? signal.reason
			: Object.assign(new Error('Resume generation cancelled'), { name: 'AbortError' });
	};
	throwIfAborted();
  // Substitute reference tokens in any prompt with real values:
  //   {job_description}                          → the JD text the user typed
  //   {job_skills}                               → skills pre-fetched for a structured job
  //   {career}                                   → all roles, one per line
  //   {companyN} (N = 1,2,…) → natural-sentence summary of the Nth career
  const contractSkills = coverageContract?.skills?.map((skill) => skill.name).filter(Boolean) ?? [];
  const tokenMap = buildTokenMap(
    identity,
    jobDescription,
    Array.isArray(jobSkills) && jobSkills.length ? jobSkills : contractSkills,
  );
  const applyTokens = (text) =>
    String(text ?? "").replace(/\{[a-z0-9_]+\}/gi, (match) => {
      const key = match.slice(1, -1).toLowerCase();
      return Object.prototype.hasOwnProperty.call(tokenMap, key) ? tokenMap[key] : match;
    });
  const dynamicTitles = Boolean(dynamicCareerTitles);
  const careers = sourceCareers(identity);

  const prefixMessages = [
    { role: "system", content: applyTokens(systemInstruction || "You are an expert resume writer.") },
    { role: "user", content: buildContextBlock(identity) },
  ];
  const contractPrompt = resumeCoveragePrompt(coverageContract);
  if (contractPrompt) prefixMessages.push({ role: "user", content: contractPrompt });
  const sections = {};
  const perStep = [];
  let usage = EMPTY_USAGE();
  let streamedUsage = EMPTY_USAGE();

  const runChain = async (entries) => {
    const messages = [...prefixMessages];
    const completed = [];
    for (const { step, index } of entries) {
      throwIfAborted();
      const isFinal = step.kind === "final";
      const name = step.name || `Step ${index}`;
      if (onStep) onStep({ phase: "step-start", index, total: steps.length, name, purpose: step.purpose, kind: step.kind });

      let userContent = applyTokens(step.prompt || "");
      if (isFinal && step.purpose === "experience") {
        userContent = appendExperienceTitlePolicy(userContent, {
          dynamicCareerTitles: dynamicTitles,
          jobDescription,
          careers,
        });
      }
      if (isFinal && step.schema) {
        userContent += `\n\nReturn ONLY a JSON object that conforms to this JSON Schema:\n${JSON.stringify(step.schema)}`;
      }
      messages.push({ role: "user", content: userContent });

      const { content, usage: stepUsage } = await chatCompletion({
        provider: providerId,
        apiKey,
        model,
        messages,
        jsonMode: isFinal,
        cacheKey: `resume-${applierName || "anon"}`,
        reasoningEffort,
        feature: `resume-generate:${step.purpose || step.kind || "step"}`,
        applierName,
        signal,
      });
      throwIfAborted();
      messages.push({ role: "assistant", content });

      let output = content;
      if (isFinal) {
        try {
          output = parseJsonLoose(content);
          if (step.purpose === "experience") {
            output = applyTitlePolicyToSections(
              { experience: output },
              identity,
              dynamicTitles,
            ).experience;
          }
        } catch (err) {
          if (Number.isInteger(err?.status)) throw err;
          const e = new Error(`${step.purpose} final step returned invalid JSON.`);
          e.status = 502;
          throw e;
        }
      }
      const entry = { index, name, purpose: step.purpose, kind: step.kind, usage: stepUsage, output };
      completed.push(entry);
      streamedUsage = addUsage(streamedUsage, stepUsage);
      if (onStep) onStep({ phase: "step-done", ...entry, cumulative: streamedUsage });
    }
    return completed;
  };

  const parallelChains = buildParallelPurposeChains(steps);
  const plannedChains = parallelChains || [{
    purpose: null,
    entries: steps.map((step, i) => ({ step: step || {}, index: i + 1 })),
  }];
  const completedChains = parallelChains
    ? await Promise.all(plannedChains.map((chain) => runChain(chain.entries)))
    : [await runChain(plannedChains[0].entries)];
  const entries = completedChains.flat().sort((left, right) => left.index - right.index);
  for (const entry of entries) {
    if (entry.kind === "final" && PURPOSES.has(entry.purpose)) sections[entry.purpose] = entry.output;
    usage = addUsage(usage, entry.usage);
    perStep.push({ ...entry, cumulative: usage });
  }

  // Safety net if Experience was produced outside the final-step branch shape.
  Object.assign(sections, applyTitlePolicyToSections(sections, identity, dynamicTitles));

  // Deterministic quality validation runs only after every AI-authored section
  // is assembled. If a required placement is absent/malformed or a forbidden
  // claim appears, rewrite only the affected section and re-audit.
  if (onStep) onStep({
    phase: "quality-start",
    name: "Resume quality audit",
    purpose: "quality",
    kind: "quality-audit",
  });
  let coverageAudit = auditResumeCoverage(sections, coverageContract, identity);
  const maxRepairAttempts = coverageContract?.maxRepairAttempts ?? 1;
  let repairIndex = steps.length;
  for (let attempt = 1; !coverageAudit.passed && attempt <= maxRepairAttempts; attempt += 1) {
    const affectedSections = [...new Set([
      ...coverageAudit.missing.map((item) => item.section),
      ...(coverageAudit.violations || []).map((item) => item.section),
      ...((coverageAudit.careerIssues || []).length ? ["experience"] : []),
    ])];
    for (const purpose of ["skills", "experience"]) {
      if (!affectedSections.includes(purpose)) continue;
      throwIfAborted();
      const missing = coverageAudit.missing
        .filter((item) => item.section === purpose)
        .map((item) => item.skill);
      const remove = (coverageAudit.violations || [])
        .filter((item) => item.section === purpose)
        .map((item) => item.skill);
      const finalDefinition = [...steps].reverse().find(
        (step) => step?.kind === "final" && step?.purpose === purpose,
      );
      const index = ++repairIndex;
      const name = `Resume quality repair: ${purpose}`;
      if (onStep) onStep({
        phase: "step-start",
        index,
        total: steps.length + affectedSections.length,
        name,
        purpose,
        kind: "coverage-repair",
      });
      const prompt = resumeCoverageRepairPrompt({
        purpose,
        missing,
        remove,
        incompleteRoles: purpose === "experience" ? coverageAudit.careerIssues : [],
        currentSection: sections[purpose],
        schema: finalDefinition?.schema,
      });
      const repair = await chatCompletion({
        provider: providerId,
        apiKey,
        model,
        messages: [...prefixMessages, { role: "user", content: prompt }],
        jsonMode: true,
        cacheKey: `resume-${applierName || "anon"}`,
        reasoningEffort,
        feature: `resume-coverage-repair:${purpose}`,
        applierName,
        signal,
      });
      throwIfAborted();
      let output = sections[purpose];
      let repairError = null;
      try {
        output = parseJsonLoose(repair.content);
        if (purpose === "experience") {
          output = applyTitlePolicyToSections(
            { experience: output },
            identity,
            dynamicTitles,
          ).experience;
        }
        sections[purpose] = output;
      } catch (error) {
        repairError = error?.message || "Coverage repair returned invalid JSON.";
      }
      usage = addUsage(usage, repair.usage);
      const entry = {
        index,
        name,
        purpose,
        kind: "coverage-repair",
        usage: repair.usage,
        output,
        ...(repairError ? { error: repairError } : {}),
        cumulative: usage,
      };
      perStep.push(entry);
      if (onStep) onStep({ phase: "step-done", ...entry });
    }
    coverageAudit = auditResumeCoverage(sections, coverageContract, identity);
  }
  if (!coverageAudit.passed) {
    const remaining = [
      ...coverageAudit.missing.map((item) => `missing ${item.skill} (${item.section})`),
      ...(coverageAudit.violations || []).map((item) => `forbidden ${item.skill} (${item.section})`),
      ...(coverageAudit.careerIssues || []).map((item) => `incomplete role #${item.index + 1} ${item.company || item.title}`),
    ]
      .join(", ");
    const error = new Error(`Resume quality gate failed: ${remaining || "required coverage is incomplete"}.`);
    error.status = 502;
    error.coverageAudit = coverageAudit;
    if (onStep) onStep({
      phase: "quality-failed",
      name: "Resume quality failed",
      purpose: "quality",
      kind: "quality-audit",
    });
    throw error;
  }
  if (onStep) onStep({
    phase: "quality-done",
    name: "Resume quality passed",
    purpose: "quality",
    kind: "quality-audit",
  });
  throwIfAborted();
  return {
    sections,
    perStep,
    usage,
    coverageContract: coverageContract ?? null,
    coverageAudit,
    isBeta: Boolean(isBeta),
    dynamicCareerTitles: dynamicTitles,
  };
}

/** Persist the finished run and sync it into the résumé library. */
export async function finalizeGenerationRun({ prep, body, result, startedAt, signal }) {
  throwIfAborted(signal);
  // Skill proficiency is derived by the scoring logic downstream, so no separate
  // LLM analysis pass runs here — the generation ends at the section steps.
  const skillProfile = [];
  const techStack = null;
  const skillAnalysisError = null;
  const isBeta = Boolean(prep.isBeta ?? result.isBeta);
  const dynamicCareerTitles = Boolean(
    prep.dynamicCareerTitles ?? result.dynamicCareerTitles,
  );
  const titlePolicyFingerprint = computeTitlePolicyFingerprint({
    dynamicCareerTitles,
    jobDescription: body.jobDescription,
    careers: sourceCareers(body.identity),
    config: body,
  });

  let identitySyncedAt = cleanString(body.identitySyncedAt) || new Date().toISOString();
  try {
    const profile = await loadDecryptedAutoBidProfile(body.applierName);
    throwIfAborted(signal);
    if (profile?.updatedAt) identitySyncedAt = cleanString(profile.updatedAt) || identitySyncedAt;
  } catch (err) {
    if (isAbortError(err)) throw err;
    /* keep fallback */
  }

  throwIfAborted(signal);
	const generationId = await saveGenerationRun({
    applierName: cleanString(body.applierName) || null,
    provider: prep.providerId,
    model: prep.model,
    status: "completed",
    backgroundTaskInputId: cleanString(body.backgroundTaskInputId) || null,
    config: configSnapshot(body),
    identity: body.identity ?? null,
    jobDescription: cleanString(body.jobDescription) || null,
    coverageAnalysis: body.coverage?.analysis ?? null,
    coverageContract: result.coverageContract ?? null,
    coverageAudit: result.coverageAudit ?? null,
    sections: result.sections,
    perStep: result.perStep,
    usage: result.usage,
    skillProfile,
    techStack,
    skillAnalysisError,
    analyzed: skillProfile.length > 0,
    analyzedAt: skillProfile.length > 0 ? new Date() : null,
    isBeta,
    dynamicCareerTitles,
    titlePolicyVersion: TITLE_POLICY_VERSION,
    titlePolicyFingerprint,
    identitySyncedAt,
    identityRefreshedAt: new Date(),
    startedAt,
    finishedAt: new Date(),
  });

  throwIfAborted(signal);
  try {
		await firestoreMutationLimiter.run(() => syncGeneratedResumeAfterRun({
      generationId,
      ownerName: cleanString(body.applierName),
      sections: result.sections,
      identity: body.identity,
      jobDescription: cleanString(body.jobDescription),
      templateId: body.templateId ?? null,
      skillProfile,
      techStack,
      skillAnalysisError,
      titlePolicyFingerprint,
      titlePolicyVersion: TITLE_POLICY_VERSION,
      isBeta,
      dynamicCareerTitles,
      identitySyncedAt,
		}));
    throwIfAborted(signal);
  } catch (syncErr) {
    if (isAbortError(syncErr)) throw syncErr;
    console.warn("[resume-generate] library sync failed:", syncErr.message);
  }

  return {
    ...result,
    skillProfile,
    techStack,
    skillAnalysisError,
    generationId,
    coverageContract: result.coverageContract ?? null,
    coverageAudit: result.coverageAudit ?? null,
    isBeta,
    dynamicCareerTitles,
    titlePolicyFingerprint,
    titlePolicyVersion: TITLE_POLICY_VERSION,
  };
}

// Persist a finished (or failed) run to the local resume_generations history.
async function saveGenerationRun(doc) {
  try {
    if (resumeGenerationsCollection) {
			const result = await firestoreMutationLimiter.run(() => resumeGenerationsCollection.insertOne(doc));
      return result.insertedId;
    }
  } catch (err) {
		if (err?.name === "AbortError") throw err;
    console.warn("[resume_generations] insert failed:", err.message);
  }
  return null;
}

function configSnapshot(body) {
  return {
    provider: body.provider,
    model: body.model,
    reasoningEffort: body.reasoningEffort ?? null,
    dynamicCareerTitles: body.dynamicCareerTitles === true,
    templateId: body.templateId ?? null,
    template: body.template ?? null,
    theme: body.theme ?? null,
    layout: body.layout ?? null,
    systemInstruction: body.systemInstruction ?? null,
    steps: body.steps ?? null,
    coverage: body.coverage?.settings ?? null,
    schemaVersion: 3,
  };
}

/**
 * POST /personal/resume-generate — non-streaming. Runs the pipeline, persists
 * the run, returns the full result + usage.
 */
export async function generateResume(req, res) {
  try {
    const queued = await enqueueStoredResumeGeneration(req, req.body || {});
    return res.status(queued.created ? 202 : 200).json({
      success: true,
      created: queued.created,
      duplicate: queued.duplicate === true,
      inputId: queued.inputId,
      task: publicTaskSnapshot(queued.task),
    });
  } catch (err) {
    const status = Number.isInteger(err?.status) ? err.status : 500;
    console.warn(`POST /api/personal/resume-generate enqueue failed (${status}): ${err.message}`);
    return res.status(status).json({ success: false, error: err.message, status });
  }
}

/**
 * POST /personal/resume-generate/stream — Server-Sent Events. Emits a `step`
 * event as each step starts/finishes (with per-step + cumulative usage), then a
 * `done` (or `error`) event. The run is persisted to history on completion.
 */
export async function generateResumeStream(req, res) {
  const body = req.body || {};
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  const send = (event, data) => {
    if (res.destroyed || res.writableEnded) return;
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  let closed = false;
  req.once("close", () => { closed = true; });
  try {
    const queued = await enqueueStoredResumeGeneration(req, body);
    send("start", {
      taskId: queued.task.id,
      inputId: queued.inputId,
      total: Array.isArray(body.steps) ? body.steps.length : 0,
      queued: true,
    });
    let lastStep = "";
    while (!closed) {
      const task = await getBackgroundTask(queued.task.id);
      if (!task) throw Object.assign(new Error("Background generation task was not found"), { status: 404 });
      const item = task.progress?.items?.[queued.inputId];
      const stepKey = JSON.stringify([item?.status, item?.stepRevision, item?.step]);
      if (item && stepKey !== lastStep) {
        lastStep = stepKey;
        send("step", item.stepEvent || {
          phase: item.status === "queued" ? "queued" : item.status,
          name: item.step || "Generating résumé",
        });
      }
      if (TERMINAL_TASK_STATUSES.has(task.status)) {
        if (task.status === "completed" || task.status === "completed_with_errors") {
          const input = await backgroundTaskInputsCollection.findOne(
            { _id: queued.inputId },
            { bypassCache: true },
          );
          if (input?.status === "completed" && input.result) {
            send("done", input.result);
          } else {
            send("error", { error: input?.error || "Resume generation did not produce a result", status: 500 });
          }
        } else {
          send("error", {
            error: task.status === "cancelled" ? "Resume generation cancelled" : task.error || "Resume generation failed",
            status: task.status === "cancelled" ? 499 : 500,
          });
        }
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  } catch (err) {
    const status = Number.isInteger(err?.status) ? err.status : 500;
    if (!closed) {
      console.warn(`stream resume-generate failed (${status}): ${err.message}`);
      send("error", { error: err.message, status });
    }
  } finally {
    if (!res.destroyed && !res.writableEnded) res.end();
  }
}

/** Fetch generated/partial editor output without putting résumé content in Redis. */
export async function getResumeGenerationTaskResult(req, res) {
  try {
    if (!backgroundTaskInputsCollection) return res.status(503).json({ success: false, error: "Database not ready" });
    // The API and background worker are separate processes. Partial reads must
    // not retain the API process's five-minute cache after the worker writes a
    // section or terminal result.
    const input = await backgroundTaskInputsCollection.findOne(
      { _id: cleanString(req.params.inputId) },
      { bypassCache: true },
    );
    if (!input) return res.status(404).json({ success: false, error: "Resume generation input not found" });
    const uid = cleanString(req.auth?.uid);
    const applierName = cleanString(req.authProfile?.profileName || req.authProfile?.applierName || req.query?.applierName);
    if (input.ownerUid && input.ownerUid !== uid) {
      return res.status(403).json({ success: false, error: "Resume generation access denied" });
    }
    if (!input.ownerUid && applierName && applierName.toLocaleLowerCase("en-US") !== String(input.applierName || "").toLocaleLowerCase("en-US")) {
      return res.status(403).json({ success: false, error: "Resume generation access denied" });
    }
    return res.status(input.status === "completed" || input.status === "failed" ? 200 : 202).json({
      success: input.status !== "failed",
      inputId: String(input._id),
      status: input.status,
      partialSections: input.partialSections || {},
      result: input.result || null,
      error: input.error || null,
      updatedAt: input.updatedAt || null,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}

/** GET /personal/resume-generator/config?applierName= — load saved config. */
export async function getGeneratorConfig(req, res) {
  try {
    const applierName = cleanString(req.query?.applierName);
    if (!applierName || !resumeGeneratorConfigCollection) return res.json({ success: true, config: null });
    const resolved = await loadGeneratorConfigRecord(applierName);
    const doc = resolved?.record ?? null;
    const migration = doc?.config ? migrateGeneratorConfig(doc.config) : null;
    if (migration?.migrated) {
      const legacyConfigBackup = doc?.legacyConfigBackup ?? {
        sourceVersion: migration.sourceVersion,
        config: doc.config,
        migratedAt: new Date(),
      };
      await resumeGeneratorConfigCollection.updateOne(
        { applierName },
        {
          $set: {
            applierName,
            config: migration.config,
            schemaVersion: 3,
            legacyConfigBackup,
            updatedAt: new Date(),
          },
        },
        { upsert: true },
      );
    }
    const updatedAt = doc?.updatedAt?.toDate instanceof Function
      ? doc.updatedAt.toDate().toISOString()
      : doc?.updatedAt ?? null;
    return res.json({
      success: true,
      config: migration?.config ?? null,
      updatedAt,
      source: resolved?.source ?? null,
      migration: migration?.migrated
        ? { from: migration.sourceVersion, to: 3 }
        : null,
      legacyJobDescription: migration?.legacyJobDescription ?? null,
    });
  } catch (err) {
    console.warn("GET /api/personal/resume-generator/config error:", err.message);
    return res.json({ success: false, config: null, error: err.message });
  }
}

/** PUT /personal/resume-generator/config — save config for the applier. */
export async function saveGeneratorConfig(req, res) {
  try {
    const body = req.body || {};
    const applierName = cleanString(body.applierName);
    if (!applierName) return res.status(400).json({ success: false, error: "applierName is required" });
    if (!resumeGeneratorConfigCollection) return res.status(503).json({ success: false, error: "DB not ready" });
    const migration = migrateGeneratorConfig(
      body.config && typeof body.config === "object" ? body.config : {},
    );
    await resumeGeneratorConfigCollection.updateOne(
      { applierName },
      {
        $set: {
          applierName,
          config: migration.config,
          schemaVersion: 3,
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    );
    return res.json({ success: true, schemaVersion: 3 });
  } catch (err) {
    console.error("PUT /api/personal/resume-generator/config error", err);
    return res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * POST /personal/llm-key-check — verify an API key is valid.
 * Body: { provider, apiKey?, applierName? } — tests the supplied key (e.g. an
 * unsaved one being typed), or the stored profile key when apiKey is omitted.
 */
export async function checkLlmKey(req, res) {
  try {
    const body = req.body || {};
    const providerId = PROVIDERS[body.provider] ? body.provider : "openai";
    let apiKey = cleanString(body.apiKey);
    if (!apiKey) {
      const profile = await findProfile(body.applierName);
      apiKey = apiKeyFor(profile, providerId);
    }
    const result = await verifyKey({ provider: providerId, apiKey });
    // On a valid key, also return the live model list so callers (e.g. the
    // Profile page model dropdown) can populate from the same round-trip using
    // the just-verified key — no second request, no key in a query string.
    let models = [];
    if (result.ok) {
      try {
        models = await listModels({ provider: providerId, apiKey });
      } catch (modelErr) {
        console.warn(`llm-key-check: model list failed for ${providerId}: ${modelErr.message}`);
      }
    }
    return res.json({ success: true, provider: providerId, models, ...result });
  } catch (err) {
    console.warn("POST /api/personal/llm-key-check error:", err.message);
    return res.json({ success: false, ok: false, message: err.message });
  }
}

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const LIST_PROJECTION = {
  "perStep.output": 0,
  "config.steps": 0,
  "config.layout": 0,
  "sections.skills": 0,
  "sections.experience": 0,
  coverageAnalysis: 0,
  coverageContract: 0,
};

/** Build compatibility filter for resume generation history (search + filters). */
function buildGenerationsFilter(query, applierName) {
  const filter = { applierName };

  const status = cleanString(query?.status) || "all";
  if (status !== "all") filter.status = status;

  const model = cleanString(query?.model);
  if (model) filter.model = model;

  const provider = cleanString(query?.provider);
  if (provider) filter.provider = provider;

  const templateId = cleanString(query?.templateId);
  if (templateId) filter["config.templateId"] = templateId;

  const fromRaw = cleanString(query?.from);
  const toRaw = cleanString(query?.to);
  if (fromRaw || toRaw) {
    filter.startedAt = {};
    if (fromRaw) {
      const from = new Date(fromRaw);
      if (!Number.isNaN(from.getTime())) filter.startedAt.$gte = from;
    }
    if (toRaw) {
      const to = new Date(toRaw);
      if (!Number.isNaN(to.getTime())) {
        to.setHours(23, 59, 59, 999);
        filter.startedAt.$lte = to;
      }
    }
    if (!Object.keys(filter.startedAt).length) delete filter.startedAt;
  }

  const search = cleanString(query?.search || query?.q);
  const searchIn = cleanString(query?.searchIn) || "all";
  if (search) {
    const rx = { $regex: escapeRegex(search), $options: "i" };
    const clauses = [];
    if (searchIn === "jd" || searchIn === "all") {
      clauses.push({ jobDescription: rx });
    }
    if (searchIn === "resume" || searchIn === "all") {
      clauses.push(
        { "sections.summary.summary": rx },
        { "sections.skills.skills.category": rx },
        { "sections.skills.skills.items": rx },
        { "sections.experience.experiences.title": rx },
        { "sections.experience.experiences.company": rx },
        { "sections.experience.experiences.bullets": rx },
        { "sections.experience.experience.title": rx },
        { "sections.experience.experience.company": rx },
        { "sections.experience.experience.bullets": rx },
        { "identity.fullName": rx },
        { "identity.email": rx },
      );
    }
    if (clauses.length) filter.$or = clauses;
  }

  return filter;
}

function buildGenerationsSort(sortKey) {
  switch (cleanString(sortKey)) {
    case "oldest":
      return { startedAt: 1 };
    case "cost-desc":
      return { "usage.cost": -1, startedAt: -1 };
    case "cost-asc":
      return { "usage.cost": 1, startedAt: -1 };
    case "tokens-desc":
      return { "usage.totalTokens": -1, startedAt: -1 };
    default:
      return { startedAt: -1 };
  }
}

async function loadGenerationFacets(applierName) {
  const base = { applierName };
  const [models, providers, templates, statusRows, totals] = await Promise.all([
    resumeGenerationsCollection.distinct("model", base),
    resumeGenerationsCollection.distinct("provider", base),
    resumeGenerationsCollection.distinct("config.templateId", base),
    resumeGenerationsCollection.aggregate([
      { $match: base },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]).toArray(),
    resumeGenerationsCollection.aggregate([
      { $match: { ...base, status: "completed" } },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          totalTokens: { $sum: { $ifNull: ["$usage.totalTokens", 0] } },
          totalCost: { $sum: { $ifNull: ["$usage.cost", 0] } },
        },
      },
    ]).toArray(),
  ]);

  const statusCounts = { completed: 0, failed: 0 };
  for (const row of statusRows) {
    if (row._id === "completed" || row._id === "failed") statusCounts[row._id] = row.count;
  }

  const agg = totals[0] || { count: 0, totalTokens: 0, totalCost: 0 };
  return {
    models: models.filter(Boolean).sort(),
    providers: providers.filter(Boolean).sort(),
    templates: templates.filter(Boolean).sort(),
    statusCounts,
    stats: {
      completed: agg.count,
      totalTokens: agg.totalTokens,
      totalCost: agg.totalCost,
    },
  };
}

/**
 * GET /personal/resume-generations?applierName=&limit=&offset=&search=&searchIn=
 *   &status=&model=&provider=&templateId=&from=&to=&sort=&includeFacets=
 * Run history with search, filters, pagination (summary snippet only — no full sections).
 */
export async function listGenerations(req, res) {
  try {
    const applierName = cleanString(req.query?.applierName);
    if (!applierName || !resumeGenerationsCollection) {
      return res.json({ success: true, runs: [], total: 0, limit: 20, offset: 0 });
    }

    const limit = Math.max(1, Math.min(100, parseInt(req.query?.limit, 10) || 20));
    const offset = Math.max(0, parseInt(req.query?.offset, 10) || 0);
    const filter = buildGenerationsFilter(req.query, applierName);
    const sort = buildGenerationsSort(req.query?.sort);

    const [total, runs, facets] = await Promise.all([
      resumeGenerationsCollection.countDocuments(filter),
      resumeGenerationsCollection
        .find(filter, { projection: LIST_PROJECTION })
        .sort(sort)
        .skip(offset)
        .limit(limit)
        .toArray(),
      req.query?.includeFacets === "1" ? loadGenerationFacets(applierName) : null,
    ]);

    return res.json({ success: true, runs, total, limit, offset, ...(facets ? { facets } : {}) });
  } catch (err) {
    console.warn("GET /api/personal/resume-generations error:", err.message);
    return res.json({ success: false, runs: [], total: 0, error: err.message });
  }
}

/** GET /personal/resume-generations/:id?applierName= — one full run (sections, config, JD). */
export async function getGeneration(req, res) {
  try {
    const applierName = cleanString(req.query?.applierName);
    const id = cleanString(req.params?.id);
    if (!resumeGenerationsCollection || !id) return res.status(400).json({ success: false, error: "id is required" });
    let _id;
    try {
      _id = new DocumentId(id);
    } catch {
      return res.status(400).json({ success: false, error: "invalid id" });
    }
    const filter = applierName ? { _id, applierName } : { _id };
    const run = await resumeGenerationsCollection.findOne(filter);
    if (!run) return res.status(404).json({ success: false, error: "Run not found" });
    return res.json({ success: true, run });
  } catch (err) {
    console.warn("GET /api/personal/resume-generations/:id error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * GET /personal/resume-generations/:id/pdf — render the stored generation to a
 * PDF and stream it inline. Lets the Agent history "View résumé" link open the
 * exact résumé that was submitted for a job. Reuses the same renderer the agent
 * used to upload it, so the PDF matches.
 */
export async function renderGenerationPdf(req, res) {
  try {
    const id = cleanString(req.params?.id);
    if (!resumeGenerationsCollection || !id) return res.status(400).json({ success: false, error: "id is required" });
    let _id;
    try {
      _id = new DocumentId(id);
    } catch {
      return res.status(400).json({ success: false, error: "invalid id" });
    }
    const run = await resumeGenerationsCollection.findOne({ _id });
    if (!run || !run.sections) return res.status(404).json({ success: false, error: "Generated résumé not found" });

    // Prefer live profile contact/header so LinkedIn/email edits show without regenerating.
    let identity = run.identity || {};
    const applierName = cleanString(run.applierName);
    if (applierName) {
      try {
        const { loadDecryptedAutoBidProfile } = await import("../services/autoBidProfileSecrets.js");
        const { identityFromProfile } = await import("../utils/identityFromProfile.js");
        const profile = await loadDecryptedAutoBidProfile(applierName);
        if (profile) identity = identityFromProfile(profile);
      } catch {
        /* keep stored identity */
      }
    }

    const { buffer } = await renderAgentResumePdf({
      sections: run.sections,
      identity,
      applierName: applierName || identity?.fullName || "Resume",
      jobId: run.generate_parent_job_id || String(run._id),
      config: run.config || {},
    });
    const safeName = String(identity?.fullName || run.applierName || "Resume").replace(/[^\w.\-()+ ]+/g, "_").trim() || "Resume";
    const asAttachment = String(req.query?.download ?? "") === "1" || String(req.query?.download ?? "").toLowerCase() === "true";
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `${asAttachment ? "attachment" : "inline"}; filename="${safeName}.pdf"`);
    return res.end(buffer);
  } catch (err) {
    console.warn("GET /api/personal/resume-generations/:id/pdf error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}

/** DELETE /personal/resume-generations/:id?applierName= — remove run + linked library resume. */
export async function deleteGeneration(req, res) {
  try {
    const applierName = cleanString(req.query?.applierName);
    const id = cleanString(req.params?.id);
    if (!id) return res.status(400).json({ success: false, error: "id is required" });
    if (!applierName) return res.status(400).json({ success: false, error: "applierName is required" });

    const result = await deleteGenerationRun(id, applierName);
    return res.json({ success: true, ...result });
  } catch (err) {
    const msg = err.message || "Delete failed";
    const status = msg.includes("not found") ? 404 : 500;
    console.warn("DELETE /api/personal/resume-generations/:id error:", msg);
    return res.status(status).json({ success: false, error: msg });
  }
}

/** GET /personal/agent-job-resume/:jobId/pdf?applierName= — stream on-disk draft PDF for Agent preview. */
export async function getAgentJobResumePdf(req, res) {
	const requestAbort = bindRequestAbort(req, res, "PDF request disconnected");
  try {
    const applierName = cleanString(req.query?.applierName);
    const jobId = cleanString(req.params?.jobId);
    if (!applierName) return res.status(400).json({ success: false, error: "applierName is required" });
    if (!jobId) return res.status(400).json({ success: false, error: "jobId is required" });

		const draft = await renderResumePdfInBackgroundLane({
			taskId: `interactive-${randomUUID()}`,
			profileId: cleanString(req.authProfile?.profileId)
				|| String((await accountInfoCollection?.findOne(
					{ name: applierName },
					{ projection: { _id: 1 } },
				))?._id || ''),
			jobId,
			signal: requestAbort.signal,
		});
		const buffer = draft?.draftPath ? await readAgentDraftPath(draft.draftPath) : null;
    if (!buffer?.length) {
      return res.status(404).json({ success: false, error: "No draft PDF for this job yet — generate résumé first" });
    }

    // Prefer profile full name (what employers should see), fall back to applier name.
    // Never append job id — that leaked into Greenhouse uploads as "David Moll-6a5656e3.pdf".
    let displayName = applierName;
    try {
      const { loadDecryptedAutoBidProfile } = await import("../services/autoBidProfileSecrets.js");
      const { identityFromProfile } = await import("../utils/identityFromProfile.js");
      const profile = await loadDecryptedAutoBidProfile(applierName);
      const fullName = profile ? identityFromProfile(profile)?.fullName : "";
      if (fullName) displayName = fullName;
    } catch {
      /* keep applierName */
    }
    const safeName = String(displayName).replace(/[^\w.\-()+ ]+/g, "_").trim() || "resume";
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${safeName}.pdf"`);
    return res.end(buffer);
  } catch (err) {
		if (isAbortError(err) && requestAbort.signal.aborted) return;
    console.warn("GET /api/personal/agent-job-resume/:jobId/pdf error:", err.message);
		const status = Number.isInteger(err?.status) ? err.status : 500;
		return res.status(status).json({ success: false, error: err.message });
	} finally {
		requestAbort.cleanup();
  }
}

/**
 * POST /personal/agent-job-resumes/status — batch check which jobs already have
 * a generated résumé for this applier. Body: { applierName, jobIds: [] }.
 * Returns { success, jobIds: [ids with an existing résumé] }.
 */
export async function getAgentJobResumesStatus(req, res) {
  try {
    const applierName = cleanString(req.body?.applierName);
    const jobIds = Array.isArray(req.body?.jobIds) ? req.body.jobIds : [];
    if (!applierName) return res.status(400).json({ success: false, error: "applierName is required" });

    const { findAgentJobResumeStatuses } = await import("../services/agentResumeGenService.js");
    const found = await findAgentJobResumeStatuses(applierName, jobIds);
    return res.json({ success: true, jobIds: found });
  } catch (err) {
    console.warn("POST /api/personal/agent-job-resumes/status error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * POST /personal/agent-job-resumes/delete — remove generated résumés for selected
 * jobs. Body: { applierName, jobIds: [] }. Does not delete the jobs themselves.
 */
export async function deleteAgentJobResumesHandler(req, res) {
  try {
    const queued = await enqueueAgentResumeRemoval(req, req.body || {});
    return res.status(queued.created ? 202 : 200).json({
      success: true,
      created: queued.created,
      task: publicTaskSnapshot(queued.task),
    });
  } catch (err) {
    const status = Number.isInteger(err?.status) ? err.status : 500;
    console.warn("POST /api/personal/agent-job-resumes/delete error:", err.message);
    return res.status(status).json({ success: false, error: err.message });
  }
}

/**
 * POST /personal/agent-job-resumes/delete/stream — remove generated résumés
 * while streaming per-job progress to the Job Search bulk action bar.
 */
export async function deleteAgentJobResumesStreamHandler(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  const send = (event, data) => {
    if (res.destroyed || res.writableEnded) return;
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  let closed = false;
  req.once("close", () => { closed = true; });
  try {
    const queued = await enqueueAgentResumeRemoval(req, req.body || {});
    let lastProgress = "";
    while (!closed) {
      const task = await getBackgroundTask(queued.task.id);
      if (!task) throw Object.assign(new Error("Background removal task was not found"), { status: 404 });
      const progress = task.progress || {};
      const progressKey = JSON.stringify(progress);
      if (progressKey !== lastProgress) {
        lastProgress = progressKey;
        send("progress", {
          phase: progress.phase || task.status,
          done: progress.completed || 0,
          total: progress.total || 0,
          left: progress.remaining || 0,
          active: progress.active || 0,
          failed: progress.failed || 0,
        });
      }
      if (TERMINAL_TASK_STATUSES.has(task.status)) {
        if (task.status === "completed" || task.status === "completed_with_errors") {
          send("done", { success: true, ...(task.result || {}) });
        } else {
          send("error", {
            error: task.status === "cancelled" ? "Resume removal cancelled" : task.error || "Resume removal failed",
            status: task.status === "cancelled" ? 499 : 500,
          });
        }
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  } catch (err) {
    if (!closed) {
      const status = Number.isInteger(err?.status) ? err.status : 500;
      console.warn(
        `POST /api/personal/agent-job-resumes/delete/stream failed (${status}): ${err.message}`,
      );
      send("error", { error: err.message, status });
    }
  } finally {
    if (!res.destroyed && !res.writableEnded) res.end();
  }
}

/** POST /personal/resume-generate/for-agent-job/stream — SSE progress for agent résumé generation. */
export async function generateResumeForAgentJobStream(req, res) {
  const body = req.body || {};
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  const send = (event, data) => {
    if (res.destroyed || res.writableEnded) return;
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  let closed = false;
  req.once("close", () => { closed = true; });
  try {
    const queued = await enqueueAgentResumeGeneration(req, body);
    const jobId = cleanString(body.jobId);
    send("start", { taskId: queued.task.id, jobId, queued: true });
    let lastStep = "";
    while (!closed) {
      const task = await getBackgroundTask(queued.task.id);
      if (!task) throw Object.assign(new Error("Background generation task was not found"), { status: 404 });
      const item = task.progress?.items?.[jobId];
      const stepKey = JSON.stringify([item?.status, item?.step]);
      if (item && stepKey !== lastStep) {
        lastStep = stepKey;
        send("step", {
          phase: item.status === "queued" ? "queued" : item.status,
          name: item.step || "Generating résumé",
        });
      }
      if (TERMINAL_TASK_STATUSES.has(task.status)) {
        if ((task.status === "completed" || task.status === "completed_with_errors") && item?.status === "completed") {
          let pdf = null;
          if (!body.deferPdf) {
						const path = cleanString(item.resumePdfPath);
						if (!path) throw new Error("Background PDF render did not return a draft path");
						const buffer = await readAgentDraftPath(path);
						if (!buffer?.length) throw new Error("Background PDF render returned an empty draft");
						pdf = { buffer, draftPath: path };
          }
          send("done", {
            ...item,
            pdfBase64: pdf?.buffer?.toString("base64") || "",
            resumePdfPath: pdf?.draftPath || item.resumePdfPath || null,
          });
        } else {
          send("error", {
            error: item?.error || (task.status === "cancelled" ? "Resume generation cancelled" : task.error || "Resume generation failed"),
            status: task.status === "cancelled" ? 499 : 500,
          });
        }
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  } catch (err) {
    if (!closed) {
      const status = Number.isInteger(err?.status) ? err.status : 500;
      console.warn(`POST /api/personal/resume-generate/for-agent-job/stream failed (${status}): ${err.message}`);
      send("error", { error: err.message, status });
    }
  } finally {
    if (!res.destroyed && !res.writableEnded) res.end();
  }
}

/** POST /personal/resume-generate/for-agent-job — agent autobid per-job resume (reuse or generate). */
export async function generateResumeForAgentJob(req, res) {
  try {
    const queued = await enqueueAgentResumeGeneration(req, req.body || {});
    return res.status(queued.created ? 202 : 200).json({
      success: true,
      created: queued.created,
      task: publicTaskSnapshot(queued.task),
    });
  } catch (err) {
    const status = Number.isInteger(err?.status) ? err.status : 500;
    console.warn(`POST /api/personal/resume-generate/for-agent-job failed (${status}): ${err.message}`);
    return res.status(status === 429 ? 429 : status >= 400 && status < 600 ? status : 500).json({
      success: false,
      error: err.message,
    });
  }
}

/**
 * POST /personal/resume-generations/refresh-identity
 * Body: { applierName }. Beta-only — updates stored identity on all completed
 * generations and re-renders per-job draft PDFs (no LLM).
 */
export async function refreshGeneratedResumesIdentityHandler(req, res) {
  try {
		const queued = await enqueueResumeIdentityRefresh(req, req.body || {});
		return res.status(queued.created ? 202 : 200).json({
			success: true,
			created: queued.created,
			task: publicTaskSnapshot(queued.task),
		});
  } catch (err) {
    const status = Number.isInteger(err?.status) ? err.status : 500;
    console.warn(`POST /api/personal/resume-generations/refresh-identity failed (${status}): ${err.message}`);
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      success: false,
      error: err.message,
      ...(err.betaRequired ? { betaRequired: true } : {}),
    });
  }
}

/**
 * POST /personal/resume-generations/refresh-identity/stream — SSE progress
 * (done / left / active) while bulk-updating generated résumés.
 */
export async function refreshGeneratedResumesIdentityStreamHandler(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  const send = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

	let closed = false;
	req.once("close", () => { closed = true; });
  try {
		const queued = await enqueueResumeIdentityRefresh(req, req.body || {});
		let lastProgress = "";
		while (!closed) {
			const task = await getBackgroundTask(queued.task.id);
			if (!task) throw Object.assign(new Error("Background refresh task was not found"), { status: 404 });
			const progress = task.progress || {};
			const progressKey = JSON.stringify(progress);
			if (progressKey !== lastProgress) {
				lastProgress = progressKey;
				send("progress", {
					phase: progress.phase || task.status,
					done: progress.completed || 0,
					total: progress.total || 0,
					left: progress.remaining || 0,
					active: progress.active || 0,
					updated: progress.updated || 0,
					pdfs: progress.pdfs || 0,
					skipped: progress.skipped || 0,
					failed: progress.failed || 0,
					alreadyCurrent: progress.alreadyCurrent || 0,
					profileUpdatedAt: progress.profileUpdatedAt || null,
					resumeUpdatedAt: progress.resumeUpdatedAt || null,
				});
			}
			if (TERMINAL_TASK_STATUSES.has(task.status)) {
				if (task.status === "completed" || task.status === "completed_with_errors") {
					send("done", { success: true, ...(task.result || {}) });
				} else {
					send("error", {
						error: task.status === "cancelled" ? "Résumé refresh cancelled" : task.error || "Résumé refresh failed",
						status: task.status === "cancelled" ? 499 : 500,
					});
				}
				break;
			}
			await new Promise((resolve) => setTimeout(resolve, 300));
		}
  } catch (err) {
    const status = Number.isInteger(err?.status) ? err.status : 500;
    console.warn(
      `POST /api/personal/resume-generations/refresh-identity/stream failed (${status}): ${err.message}`,
    );
		if (!closed) send("error", {
      error: err.message,
      status,
      ...(err.betaRequired ? { betaRequired: true } : {}),
    });
  }
	if (!res.destroyed && !res.writableEnded) res.end();
}
