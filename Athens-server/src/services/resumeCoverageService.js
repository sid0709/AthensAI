import { createHash } from "node:crypto";
import { STATIC_ALIASES, toCanonical } from "@nextoffer/shared/skill-normalize";
import { chatCompletion } from "./llm/llmService.js";
import { reasoningEffortForExtraction } from "./jobSkillExtraction/aiExtractService.js";
import { normalizeCoverageSettings } from "./resumeGeneratorConfigSchema.js";

export const RESUME_COVERAGE_ANALYSIS_VERSION = 3;
export const RESUME_COVERAGE_CONTRACT_VERSION = 2;
export const RESUME_COVERAGE_AUDIT_VERSION = 2;

const CATEGORIES = new Set(["language", "framework", "platform", "protocol", "data", "cloud", "tool", "method", "domain"]);
const DECISIONS = new Set(["used", "familiar", "exclude"]);
const PLACEMENTS = new Set(["skills", "experience"]);
const ORIGINS = new Set(["jd", "career", "inferred"]);
const CONFIDENCES = new Set(["explicit", "strongly_implied", "commonly_expected"]);

const RESUME_COVERAGE_ANALYSIS_PROMPT = `You are building a candidate-aware, truthful ledger of concrete named technologies for a targeted résumé.

Read both the job description and career history. Return three kinds of items:
1. jd: every concrete technology, product, standard, protocol, acronym, language, framework, library, platform, database, or named format explicitly present in the job description.
2. career: relevant named technologies explicitly present in the career history, even when absent from the job description.
3. inferred: a limited set of high-confidence companion technologies that are a direct production dependency or strongly established ecosystem companion of multiple explicit signals.

A valid item is the shortest atomic canonical résumé keyword. A capability, activity, architecture idea, soft skill, or common-noun phrase is not valid.

Rules:
1. Include every explicit JD name and relevant career-history name. Include at most 24 inferred companions and prefer precision over volume.
2. An inferred companion must cite at least two accepted explicit signals in inferredFrom. Never infer that the candidate used it, and never select a vendor or product when several alternatives are equally plausible.
3. Split a list of names into distinct atomic items rather than returning the list as one item.
4. Preserve canonical casing, punctuation, and abbreviation spelling. Capitalization is not evidence that a phrase is a proper skill name. Reject title-cased generic category labels and common nouns; for example, “Programming Language” is not a skill. If the posting says “Python (Programming Language)”, output only “Python”.
5. Provide only genuine aliases, abbreviations, spelling variants, or singular/plural forms. Never add related technologies as aliases.
6. For jd items, requirement is 5 for core/repeated must-haves, 4 for clearly required terms, 3 for relevant body terms, 2 for preferred/example alternatives, and 1 for passing mentions. Career-only and inferred items must be 1–3 because they are not JD requirements.
7. For explicit items, sourceText must be a short verbatim phrase containing the item. For inferred items, sourceText is a concise non-claiming rationale.
8. Never output a common-noun capability, activity, architecture, or workflow phrase. If one contains one or more named technologies, output only those atomic names.
9. Exclude soft skills, the hiring company's name (unless it is also an explicitly required product), benefits, degrees, seniority, and years of experience.
10. Before returning an item, ask whether the text uniquely names a specific technology, product, standard, protocol, language, framework, library, platform, database, or named format. If it merely names a type or category of skill—even when every word starts with a capital letter—exclude it.
11. confidence is explicit for literal JD/career items, strongly_implied for direct dependencies, and commonly_expected only for stable production companions supported by multiple signals.

Output ONLY JSON:
{
  "skills": [
    {
      "name": "canonical name",
      "aliases": ["genuine spelling variant"],
      "category": "language | framework | platform | protocol | data | cloud | tool | method | domain",
      "origin": "jd | career | inferred",
      "confidence": "explicit | strongly_implied | commonly_expected",
      "inferredFrom": ["explicit signal name"],
      "requirement": 1,
      "sourceText": "short evidence or non-claiming rationale"
    }
  ]
}`;

const cleanString = (value) => String(value ?? "").trim();

function technologyTokenKind(token, tokenCount) {
  const value = cleanString(token).replace(/^[('-]+|[)'-]+$/g, "");
  if (!value) return null;
  if (/^\d+(?:\.\d+)*$/.test(value)) return "modifier";
  if (/[-.#+]/.test(value) && /[a-z]/i.test(value)) return "core";
  if (/^(?=.*[A-Z])[A-Z0-9]+s?$/.test(value)) return "core";
  if (/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(value) && /[A-Z]/.test(value) && /[a-z]/.test(value)) {
    return "core";
  }
  if (/^[a-z]{1,4}$/.test(value)) return tokenCount === 1 ? "core" : "modifier";
  return null;
}

function isNamedTechnologySurface(value) {
  const name = cleanString(value);
  if (!name || name.length > 100 || /[,;]/.test(name)) return false;
  const tokens = name.match(/[A-Za-z0-9][A-Za-z0-9.+#'-]*/g) || [];
  if (!tokens.length) return false;
  const kinds = tokens.map((token) => technologyTokenKind(token, tokens.length));
  return kinds.every(Boolean) && kinds.includes("core");
}

function parseJsonObject(content) {
  const raw = cleanString(content);
  if (!raw) return null;
  const unfenced = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try {
    return JSON.parse(unfenced);
  } catch {
    const start = unfenced.indexOf("{");
    const end = unfenced.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(unfenced.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function regexEscape(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function aliasVariants(alias) {
  const value = cleanString(alias);
  if (!value) return [];
  const variants = new Set([value]);
  const words = value.split(/\s+/);
  const last = words.at(-1) || "";
  if (/^[a-z][a-z -]{2,}$/i.test(value) && last.length > 3) {
    if (/ies$/i.test(last)) variants.add([...words.slice(0, -1), `${last.slice(0, -3)}y`].join(" "));
    else if (/s$/i.test(last) && !/ss$/i.test(last)) variants.add([...words.slice(0, -1), last.slice(0, -1)].join(" "));
    else variants.add([...words.slice(0, -1), `${last}s`].join(" "));
  }
  return [...variants];
}

function phrasePattern(alias) {
  const parts = cleanString(alias)
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .match(/[a-z0-9]+(?:[+#]+)?/g);
  if (!parts?.length) return null;
  const body = parts.map(regexEscape).join("[\\s./_\\-]*");
  return new RegExp(`(?:^|[^a-z0-9+#])${body}(?=$|[^a-z0-9+#])`, "iu");
}

function phraseSurfacePattern(alias) {
  const parts = cleanString(alias)
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .match(/[a-z0-9]+(?:[+#]+)?/g);
  if (!parts?.length) return null;
  const body = parts.map(regexEscape).join("[\\s./_\\-]*");
  return new RegExp(`(?:^|[^a-z0-9+#])(${body})(?=$|[^a-z0-9+#])`, "giu");
}

function configuredAliases(name, aliases) {
  if (!aliases || typeof aliases !== "object") return [];
  const canonical = toCanonical(name);
  const out = [];
  for (const [key, values] of Object.entries(aliases)) {
    if (toCanonical(key) !== canonical || !Array.isArray(values)) continue;
    out.push(...values.map(cleanString).filter(Boolean));
  }
  return out;
}

export function aliasesForCoverageSkill(skill, aliases = {}) {
  const name = cleanString(typeof skill === "string" ? skill : skill?.name);
  const supplied = Array.isArray(skill?.aliases) ? skill.aliases : [];
  const canonical = toCanonical(name);
  const builtIn = STATIC_ALIASES[canonical] || [];
  return [...new Set(
    [name, ...supplied, ...builtIn, ...configuredAliases(name, aliases)]
      .flatMap(aliasVariants)
      .map(cleanString)
      .filter(Boolean),
  )].slice(0, 30);
}

export function textContainsCoverageSkill(text, skill, aliases = {}) {
  const haystack = String(text ?? "").normalize("NFKC").toLocaleLowerCase("en-US");
  if (!haystack) return false;
  return aliasesForCoverageSkill(skill, aliases).some((alias) => {
    const pattern = phrasePattern(alias);
    return pattern ? pattern.test(haystack) : false;
  });
}

/** Exact canonical Markdown form required by the résumé coverage contract. */
export function textContainsBoldCoverageSkill(text, skill) {
  const name = cleanString(typeof skill === "string" ? skill : skill?.name).normalize("NFKC");
  if (!name) return false;
  const body = regexEscape(name).replace(/\s+/g, "\\s+");
  return new RegExp(`\\*\\*\\s*${body}\\s*\\*\\*`, "u").test(String(text ?? "").normalize("NFKC"));
}

/**
 * A coverage item must be both grounded in the JD and look like a real name in
 * the JD's original casing. This prevents a model from turning a common phrase
 * such as "data modeling" into the misleading label "Data Modeling".
 */
export function isNamedResumeCoverageSkill(skill, jobDescription, aliases = {}) {
  const name = cleanString(typeof skill === "string" ? skill : skill?.name);
  if (!isNamedTechnologySurface(name)) return false;
  const text = String(jobDescription ?? "").normalize("NFKC");
  if (!text) return false;
  return aliasesForCoverageSkill(skill, aliases).some((alias) => {
    const pattern = phraseSurfacePattern(alias);
    if (!pattern) return false;
    return [...text.matchAll(pattern)].some((match) => isNamedTechnologySurface(match[1]));
  });
}

function careerCorpus(identity) {
  return (Array.isArray(identity?.careers) ? identity.careers : [])
    .map((career) => [career?.title, career?.description].map(cleanString).filter(Boolean).join(" — "))
    .filter(Boolean)
    .join("\n");
}

function evidenceForSkill(identity, skill, aliases) {
  const careers = Array.isArray(identity?.careers) ? identity.careers : [];
  const evidence = [];
  for (let roleIndex = 0; roleIndex < careers.length; roleIndex += 1) {
    const career = careers[roleIndex];
    const text = [career?.title, career?.description].map(cleanString).filter(Boolean).join(" — ");
    if (!textContainsCoverageSkill(text, skill, aliases)) continue;
    evidence.push({
      roleIndex,
      company: cleanString(career?.company),
      title: cleanString(career?.title),
      excerpt: cleanString(career?.description || text).slice(0, 240),
    });
  }
  return evidence.slice(0, 5);
}

function analysisFingerprint(jobDescription, identity, skills) {
  return createHash("sha256")
    .update(String(jobDescription ?? ""))
    .update("\0")
    .update(JSON.stringify(identity ?? {}))
    .update("\0")
    .update(JSON.stringify(skills.map(({ id, name, aliases, requirement, origin, confidence, inferredFrom }) => ({
      id,
      name,
      aliases,
      requirement,
      origin,
      confidence,
      inferredFrom,
    }))))
    .digest("hex");
}

/**
 * Parenthetical technology/example lists are where extraction models most often
 * drop alternatives. Preserve every explicit named list item deterministically,
 * then let evidence review decide whether the candidate may claim it.
 */
export function extractParentheticalCoverageCandidates(jobDescription) {
  const text = String(jobDescription ?? "");
  const candidates = [];
  const seen = new Set();
  const stop = new Set(["e.g", "eg", "i.e", "ie", "etc", "and more", "among others"]);
  for (const match of text.matchAll(/\(([^()\n]{1,240})\)/g)) {
    const inside = cleanString(match[1]);
    const context = text.slice(Math.max(0, (match.index ?? 0) - 120), match.index ?? 0);
    const requirement = /preferred|nice.to.have|plus/i.test(context)
      ? 2
      : /required|strong experience|hands.on experience|experience\s+(?:with|integrating|designing|building|using)|proficien|expertise/i.test(context)
        ? 4
        : 3;
    for (const part of inside.split(/[,;/]|\bor\b/gi)) {
      const name = cleanString(part)
        .replace(/^(?:e\.g\.?|i\.e\.?|such as|including|and)\s*/i, "")
        .replace(/\betc\.?$/i, "")
        .replace(/^[–—-]+|[–—-]+$/g, "")
        .trim();
      const normalized = name.toLocaleLowerCase("en-US").replace(/\.$/, "");
      const wordCount = name.split(/\s+/).filter(Boolean).length;
      if (
        !name
        || name.length < 2
        || name.length > 80
        || wordCount > 7
        || stop.has(normalized)
        || /^\d/.test(name)
        || /\b(?:years?|months?|remote|present|preferred qualifications?)\b/i.test(name)
        || !isNamedResumeCoverageSkill(name, text)
      ) continue;
      const canonical = toCanonical(name);
      if (!canonical || seen.has(canonical)) continue;
      seen.add(canonical);
      candidates.push({ name, category: "method", requirement, sourceText: `(${inside})` });
    }
  }
  return candidates.slice(0, 60);
}

export function parseResumeCoverageAnalysis(content, {
  jobDescription,
  identity,
  aliases = {},
} = {}) {
  const parsed = parseJsonObject(content);
  const rows = Array.isArray(parsed?.skills) ? parsed.skills : [];
  const careerText = careerCorpus(identity);
  const deduped = new Map();
  const inferredRows = [];

  const upsertExplicit = (entry) => {
    const canonical = toCanonical(entry.name);
    if (!canonical) return;
    const previous = deduped.get(canonical);
    if (!previous) {
      deduped.set(canonical, entry);
      return;
    }
    const evidence = [...new Map(
      [...(previous.evidence || []), ...(entry.evidence || [])]
        .map((item) => [`${item.roleIndex}:${item.company}:${item.title}`, item]),
    ).values()];
    const aliasesMerged = [...new Set([...(previous.aliases || []), ...(entry.aliases || [])])];
    const preferEntry = entry.origin === "jd" && previous.origin !== "jd";
    deduped.set(canonical, {
      ...(preferEntry ? previous : entry),
      ...(preferEntry ? entry : previous),
      origin: previous.origin === "jd" || entry.origin === "jd" ? "jd" : "career",
      confidence: "explicit",
      requirement: Math.max(previous.requirement, entry.requirement),
      aliases: aliasesMerged,
      evidence,
    });
  };

  for (const row of rows.slice(0, 120)) {
    const name = cleanString(row?.name);
    if (!name) continue;
    const itemAliases = aliasesForCoverageSkill({ name, aliases: row?.aliases }, aliases);
    const candidate = { name, aliases: itemAliases };
    const inJob = textContainsCoverageSkill(jobDescription, candidate, aliases)
      && isNamedResumeCoverageSkill(candidate, jobDescription, aliases);
    const evidence = evidenceForSkill(identity, candidate, aliases);
    const inCareer = Boolean(evidence.length)
      && textContainsCoverageSkill(careerText, candidate, aliases)
      && isNamedResumeCoverageSkill(candidate, careerText, aliases);
    if (!inJob && !inCareer) {
      if (row?.origin === "inferred" && isNamedTechnologySurface(name)) inferredRows.push(row);
      continue;
    }
    const canonical = toCanonical(name);
    const rawRequirement = Math.min(5, Math.max(1, Math.round(Number(row?.requirement)) || 3));
    const origin = inJob ? "jd" : "career";
    upsertExplicit({
      id: createHash("sha1").update(canonical).digest("hex").slice(0, 12),
      name,
      aliases: itemAliases.filter((alias) => alias.toLocaleLowerCase("en-US") !== name.toLocaleLowerCase("en-US")),
      category: CATEGORIES.has(row?.category) ? row.category : "tool",
      origin,
      confidence: "explicit",
      inferredFrom: [],
      requirement: origin === "jd" ? rawRequirement : Math.min(3, rawRequirement),
      sourceText: cleanString(row?.sourceText).slice(0, 280),
      evidence,
    });
  }
  for (const candidate of extractParentheticalCoverageCandidates(jobDescription)) {
    const canonical = toCanonical(candidate.name);
    const existing = deduped.get(canonical);
    if (existing) {
      if (candidate.requirement > existing.requirement) {
        deduped.set(canonical, { ...existing, requirement: candidate.requirement });
      }
      continue;
    }
    // A broader canonical skill may already cover this literal variant.
    if ([...deduped.values()].some((skill) => textContainsCoverageSkill(candidate.name, skill, aliases))) continue;
    const itemAliases = aliasesForCoverageSkill(candidate, aliases);
    upsertExplicit({
      id: createHash("sha1").update(canonical).digest("hex").slice(0, 12),
      ...candidate,
      aliases: itemAliases.filter((alias) => alias.toLocaleLowerCase("en-US") !== candidate.name.toLocaleLowerCase("en-US")),
      origin: "jd",
      confidence: "explicit",
      inferredFrom: [],
      evidence: evidenceForSkill(identity, candidate, aliases),
    });
  }

  const explicitAnchorKeys = new Set();
  for (const skill of deduped.values()) {
    for (const value of [skill.name, ...(skill.aliases || [])]) {
      const key = toCanonical(value);
      if (key) explicitAnchorKeys.add(key);
    }
  }
  let inferredCount = 0;
  for (const row of inferredRows) {
    if (inferredCount >= 24) break;
    const name = cleanString(row?.name);
    const canonical = toCanonical(name);
    if (!canonical || deduped.has(canonical)) continue;
    const confidence = CONFIDENCES.has(row?.confidence) && row.confidence !== "explicit"
      ? row.confidence
      : null;
    if (!confidence) continue;
    const inferredFrom = [...new Set(
      (Array.isArray(row?.inferredFrom) ? row.inferredFrom : [])
        .map(cleanString)
        .filter(Boolean),
    )];
    const anchored = [...new Set(inferredFrom.map(toCanonical).filter((key) => explicitAnchorKeys.has(key)))];
    if (anchored.length < 2) continue;
    const itemAliases = aliasesForCoverageSkill({ name, aliases: row?.aliases }, aliases);
    const candidate = { name, aliases: itemAliases };
    if (textContainsCoverageSkill(jobDescription, candidate, aliases)) continue;
    if (textContainsCoverageSkill(careerText, candidate, aliases)) continue;
    const requirement = Math.min(3, Math.max(1, Math.round(Number(row?.requirement)) || 2));
    deduped.set(canonical, {
      id: createHash("sha1").update(canonical).digest("hex").slice(0, 12),
      name,
      aliases: itemAliases.filter((alias) => alias.toLocaleLowerCase("en-US") !== name.toLocaleLowerCase("en-US")),
      category: CATEGORIES.has(row?.category) ? row.category : "tool",
      origin: "inferred",
      confidence,
      inferredFrom,
      requirement,
      sourceText: cleanString(row?.sourceText).slice(0, 280),
      evidence: [],
    });
    inferredCount += 1;
  }

  const skills = [...deduped.values()]
    .sort((left, right) => right.requirement - left.requirement || left.name.localeCompare(right.name))
    .map((skill) => ({
      ...skill,
      evidenceStatus: skill.evidence.length ? "verified" : "unverified",
      decision: skill.evidence.length ? "used" : "familiar",
    }));
  return {
    schemaVersion: RESUME_COVERAGE_ANALYSIS_VERSION,
    fingerprint: analysisFingerprint(jobDescription, identity, skills),
    jobDescriptionHash: createHash("sha256").update(String(jobDescription ?? "")).digest("hex"),
    skills,
    unresolvedCount: skills.filter((skill) => !skill.decision).length,
  };
}

export async function analyzeResumeCoverage({
  providerId,
  apiKey,
  model,
  applierName,
  jobDescription,
  identity,
  aliases,
  experienceRequirementThreshold,
  signal,
}) {
  const description = cleanString(jobDescription);
  if (!description) throw Object.assign(new Error("jobDescription is required"), { status: 400 });
  const response = await chatCompletion({
    provider: providerId,
    apiKey,
    model,
    jsonMode: true,
    feature: "resume-coverage-analysis",
    applierName,
    reasoningEffort: reasoningEffortForExtraction(providerId, model),
    signal,
    messages: [
      { role: "system", content: RESUME_COVERAGE_ANALYSIS_PROMPT },
      {
        role: "user",
        content: [
          `JOB DESCRIPTION:\n${description.slice(0, 20_000)}`,
          `CAREER HISTORY:\n${JSON.stringify(Array.isArray(identity?.careers) ? identity.careers : [], null, 2).slice(0, 20_000)}`,
        ].join("\n\n"),
      },
    ],
  });
  const analysis = parseResumeCoverageAnalysis(response?.content, {
    jobDescription: description,
    identity,
    aliases,
    experienceRequirementThreshold,
  });
  if (!analysis.skills.length) {
    throw Object.assign(new Error("No explicit technical skills could be extracted from this job description."), { status: 422 });
  }
  return { analysis, usage: response?.usage ?? null };
}

export function buildResumeCoverageContract(analysis, decisions = {}, rawSettings = {}) {
  if (!analysis || !Array.isArray(analysis.skills)) return null;
  const settings = normalizeCoverageSettings(rawSettings);
  if (!settings.enabled) return null;
  const unresolved = [];
  const excluded = [];
  const skills = [];
  for (const item of analysis.skills) {
    const explicit = cleanString(decisions?.[item.id] ?? item.decision);
    const decision = DECISIONS.has(explicit) ? explicit : null;
    if (!decision) {
      unresolved.push({ id: item.id, name: item.name });
      continue;
    }
    if (decision === "exclude") {
      excluded.push({ id: item.id, name: item.name, reason: "candidate-declined" });
      continue;
    }
    const requirement = Math.min(5, Math.max(1, Math.round(Number(item.requirement)) || 3));
    const origin = ORIGINS.has(item.origin) ? item.origin : "jd";
    const evidence = (Array.isArray(item.evidence) ? item.evidence : []).map((entry) => ({
      roleIndex: Number.isInteger(entry?.roleIndex) ? entry.roleIndex : null,
      company: cleanString(entry?.company),
      title: cleanString(entry?.title),
      excerpt: cleanString(entry?.excerpt).slice(0, 240),
    })).filter((entry) => entry.roleIndex != null || entry.company || entry.title);
    const verified = item.evidenceStatus === "verified" || evidence.length > 0;
    const allowedPlacements = ["skills"];
    const mayUseInExperience = decision === "used"
      && (verified || (origin === "jd" && requirement >= settings.experienceRequirementThreshold));
    if (mayUseInExperience) allowedPlacements.push("experience");
    const requiredPlacements = ["skills"];
    if (
      mayUseInExperience
      && origin === "jd"
      && requirement >= settings.experienceRequirementThreshold
    ) requiredPlacements.push("experience");
    skills.push({
      id: cleanString(item.id),
      name: cleanString(item.name),
      aliases: aliasesForCoverageSkill(item, settings.aliases),
      category: CATEGORIES.has(item.category) ? item.category : "tool",
      origin,
      confidence: CONFIDENCES.has(item.confidence) ? item.confidence : origin === "inferred" ? "commonly_expected" : "explicit",
      inferredFrom: (Array.isArray(item.inferredFrom) ? item.inferredFrom : []).map(cleanString).filter(Boolean).slice(0, 12),
      requirement,
      evidenceStatus: verified ? "verified" : decision === "used" ? "candidate-confirmed" : "unverified",
      evidence,
      decision,
      allowedPlacements,
      requiredPlacements,
      placements: requiredPlacements,
    });
  }
  return {
    schemaVersion: RESUME_COVERAGE_CONTRACT_VERSION,
    sourceAnalysisFingerprint: cleanString(analysis.fingerprint),
    experienceRequirementThreshold: settings.experienceRequirementThreshold,
    maxRepairAttempts: settings.maxRepairAttempts,
    skills,
    excluded,
    unresolved,
  };
}

/**
 * Build the same automatic decisions the Resume Editor applies after analysis.
 * Structured Job Search / Agent runs have no intermediate review screen, so the
 * analysis defaults are the run-scoped decisions unless a future caller supplies
 * explicit overrides.
 */
export function buildAutomaticResumeCoveragePayload(analysis, rawSettings = {}) {
  if (!analysis || !Array.isArray(analysis.skills)) return null;
  const settings = normalizeCoverageSettings(rawSettings);
  if (!settings.enabled) return null;
  const decisions = Object.fromEntries(analysis.skills.map((skill) => {
    const supplied = cleanString(skill?.decision);
    const decision = DECISIONS.has(supplied)
      ? supplied
      : skill?.evidenceStatus === "verified"
        ? "used"
        : "familiar";
    return [cleanString(skill?.id), decision];
  }).filter(([id]) => id));
  return { analysis, decisions, settings };
}

export function normalizeResumeCoverageContract(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (raw.analysis) return buildResumeCoverageContract(raw.analysis, raw.decisions, raw.settings);
  if (!Array.isArray(raw.skills)) return null;
  const skills = raw.skills.map((item) => {
    const decision = item?.decision === "familiar" ? "familiar" : "used";
    const legacyPlacements = Array.isArray(item?.placements) ? item.placements : ["skills"];
    const requiredPlacements = [...new Set(
      (Array.isArray(item?.requiredPlacements) ? item.requiredPlacements : legacyPlacements)
        .filter((placement) => PLACEMENTS.has(placement)),
    )];
    const allowedPlacements = [...new Set(
      (Array.isArray(item?.allowedPlacements) ? item.allowedPlacements : requiredPlacements)
        .filter((placement) => PLACEMENTS.has(placement)),
    )];
    if (!requiredPlacements.includes("skills")) requiredPlacements.unshift("skills");
    if (!allowedPlacements.includes("skills")) allowedPlacements.unshift("skills");
    const evidence = (Array.isArray(item?.evidence) ? item.evidence : []).map((entry) => ({
      roleIndex: Number.isInteger(entry?.roleIndex) ? entry.roleIndex : null,
      company: cleanString(entry?.company),
      title: cleanString(entry?.title),
      excerpt: cleanString(entry?.excerpt).slice(0, 240),
    })).filter((entry) => entry.roleIndex != null || entry.company || entry.title);
    return {
      id: cleanString(item?.id),
      name: cleanString(item?.name),
      aliases: aliasesForCoverageSkill(item),
      category: CATEGORIES.has(item?.category) ? item.category : "tool",
      origin: ORIGINS.has(item?.origin) ? item.origin : "jd",
      confidence: CONFIDENCES.has(item?.confidence) ? item.confidence : "explicit",
      inferredFrom: (Array.isArray(item?.inferredFrom) ? item.inferredFrom : []).map(cleanString).filter(Boolean).slice(0, 12),
      requirement: Math.min(5, Math.max(1, Number(item?.requirement) || 3)),
      evidenceStatus: item?.evidenceStatus === "verified"
        ? "verified"
        : item?.evidenceStatus === "unverified"
          ? "unverified"
          : "candidate-confirmed",
      evidence,
      decision,
      allowedPlacements,
      requiredPlacements,
      placements: requiredPlacements,
    };
  }).filter((item) => item.name && item.requiredPlacements.length);
  return {
    schemaVersion: RESUME_COVERAGE_CONTRACT_VERSION,
    sourceAnalysisFingerprint: cleanString(raw.sourceAnalysisFingerprint),
    experienceRequirementThreshold: 4,
    maxRepairAttempts: Math.min(2, Math.max(0, Number(raw.maxRepairAttempts) || 0)),
    skills,
    excluded: Array.isArray(raw.excluded) ? raw.excluded : [],
    unresolved: Array.isArray(raw.unresolved) ? raw.unresolved : [],
  };
}

function skillItemTexts(section) {
  const groups = Array.isArray(section?.skills) ? section.skills : [];
  return groups.flatMap((group) => (
    Array.isArray(group?.items) ? group.items.map(cleanString).filter(Boolean) : []
  ));
}

function skillItemKey(value) {
  return toCanonical(cleanString(value).replace(/\*\*/g, ""));
}

function coverageCategoryLabel(value) {
  const name = cleanString(value).replace(/[_-]+/g, " ");
  if (!name) return "Skills";
  return name.replace(/\b\w/g, (character) => character.toUpperCase());
}

/** Normalize model-authored Skills into the exact closed set required by coverage. */
export function normalizeSkillsSectionToContract(section, rawContract) {
  const contract = normalizeResumeCoverageContract(rawContract);
  if (!contract) return section;
  const required = contract.skills.filter((skill) => skill.requiredPlacements.includes("skills"));
  const sourceGroups = Array.isArray(section?.skills) ? section.skills : [];
  const matches = new Map();
  const categoryByType = new Map();
  for (const group of sourceGroups) {
    const category = cleanString(group?.category) || "Skills";
    for (const item of Array.isArray(group?.items) ? group.items : []) {
      const key = skillItemKey(item);
      if (!key) continue;
      const skill = required.find((candidate) => (
        [candidate.name, ...(candidate.aliases || [])].some((name) => toCanonical(name) === key)
      ));
      if (!skill || matches.has(skill.id)) continue;
      matches.set(skill.id, category);
      if (!categoryByType.has(skill.category)) categoryByType.set(skill.category, category);
    }
  }

  const groups = new Map();
  for (const skill of required) {
    const category = matches.get(skill.id)
      || categoryByType.get(skill.category)
      || coverageCategoryLabel(skill.category);
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(`**${skill.name}**`);
  }
  return {
    skills: [...groups].map(([category, items]) => ({ category, items })),
  };
}

function auditSkillItemShape(values, required) {
  const exactItems = new Map(required.map((skill) => [`**${skill.name}**`, skill]));
  const issues = [];
  for (const value of values) {
    if (exactItems.has(value)) continue;
    const matches = required.filter((skill) => textContainsCoverageSkill(value, skill));
    issues.push({
      section: "skills",
      reason: matches.length > 1 ? "compound-item" : matches.length === 1 ? "noncanonical-item" : "unexpected-item",
      item: value.slice(0, 160),
    });
  }
  for (const skill of required) {
    const count = values.filter((value) => value === `**${skill.name}**`).length;
    if (count > 1) {
      issues.push({
        section: "skills",
        reason: "duplicate-skill",
        skillId: skill.id,
        skill: skill.name,
        count,
      });
    }
  }
  return issues;
}

function experienceRows(section) {
  return Array.isArray(section?.experiences)
    ? section.experiences
    : Array.isArray(section?.experience)
      ? section.experience
      : [];
}

function experienceBulletTexts(section) {
  return experienceRows(section).flatMap((row) => (
    Array.isArray(row?.bullets) ? row.bullets.map(cleanString).filter(Boolean) : []
  ));
}

function isSubstantiveExperienceBullet(value) {
  const words = cleanString(value).match(/[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu) || [];
  return words.length >= 6;
}

function hasContextualBoldExperiencePlacement(bullet, skill) {
  if (!textContainsBoldCoverageSkill(bullet, skill)) return false;
  const words = String(bullet ?? "")
    .replace(/\*\*/g, "")
    .match(/[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu) || [];
  return words.length >= 8;
}

function auditExperienceKeywordUse(section, contract) {
  const rows = experienceRows(section);
  const issues = [];
  const rolesByCandidateConfirmedSkill = new Map();
  rows.forEach((row, roleIndex) => {
    const bullets = Array.isArray(row?.bullets) ? row.bullets.map(cleanString).filter(Boolean) : [];
    const occurrences = new Map();
    bullets.forEach((bullet, bulletIndex) => {
      const matches = contract.skills.filter((skill) => textContainsCoverageSkill(bullet, skill));
      if (matches.length > 3) {
        issues.push({
          section: "experience",
          reason: "keyword-density",
          roleIndex,
          bulletIndex,
          skills: matches.map((skill) => skill.name),
        });
      }
      for (const skill of matches) {
        occurrences.set(skill.id, (occurrences.get(skill.id) || 0) + 1);
      }
    });

    for (const skill of contract.skills) {
      const count = occurrences.get(skill.id) || 0;
      if (!count) continue;
      if (count > 2) {
        issues.push({
          section: "experience",
          reason: "repeated-skill",
          skillId: skill.id,
          skill: skill.name,
          roleIndex,
          count,
        });
      }
      const evidenceRoles = new Set(
        (skill.evidence || [])
          .map((item) => item.roleIndex)
          .filter((index) => Number.isInteger(index)),
      );
      if (skill.evidenceStatus === "verified" && evidenceRoles.size && !evidenceRoles.has(roleIndex)) {
        issues.push({
          section: "experience",
          reason: "unsupported-role-placement",
          skillId: skill.id,
          skill: skill.name,
          roleIndex,
          permittedRoleIndexes: [...evidenceRoles],
        });
      }
      if (skill.evidenceStatus === "candidate-confirmed") {
        if (!rolesByCandidateConfirmedSkill.has(skill.id)) rolesByCandidateConfirmedSkill.set(skill.id, new Set());
        rolesByCandidateConfirmedSkill.get(skill.id).add(roleIndex);
      }
    }
  });

  for (const [skillId, roleIndexes] of rolesByCandidateConfirmedSkill) {
    if (roleIndexes.size <= 1) continue;
    const skill = contract.skills.find((item) => item.id === skillId);
    issues.push({
      section: "experience",
      reason: "unsupported-role-spread",
      skillId,
      skill: skill?.name || "",
      roleIndexes: [...roleIndexes],
    });
  }
  return issues;
}

export function auditResumeCoverage(sections, rawContract, identity) {
  const contract = normalizeResumeCoverageContract(rawContract);
  const careers = Array.isArray(identity?.careers) ? identity.careers : [];
  const generatedCareers = experienceRows(sections?.experience);
  const result = {
    schemaVersion: RESUME_COVERAGE_AUDIT_VERSION,
    passed: true,
    requiredCount: 0,
    coveredCount: 0,
    sections: {},
    missing: [],
    violations: [],
    skillIssues: [],
    experienceIssues: [],
    requiredRoleCount: careers.length,
    completeRoleCount: 0,
    careerIssues: [],
  };
  careers.forEach((career, index) => {
    const generated = generatedCareers[index];
    const bullets = Array.isArray(generated?.bullets) ? generated.bullets : [];
    if (bullets.some(isSubstantiveExperienceBullet)) {
      result.completeRoleCount += 1;
      return;
    }
    result.careerIssues.push({
      index,
      company: cleanString(career?.company),
      title: cleanString(career?.title),
      period: cleanString(career?.period),
      description: cleanString(career?.description).slice(0, 800),
      reason: generated ? "no-substantive-bullets" : "missing-role",
    });
  });
  if (!contract) {
    result.passed = result.careerIssues.length === 0;
    return result;
  }
  const excluded = contract.excluded
    .map((skill) => ({ id: cleanString(skill?.id), name: cleanString(skill?.name) }))
    .filter((skill) => skill.name);
  for (const section of PLACEMENTS) {
    const required = contract.skills.filter((skill) => skill.requiredPlacements.includes(section));
    const values = section === "experience"
      ? experienceBulletTexts(sections?.experience)
      : skillItemTexts(sections?.skills);
    const skillIssues = section === "skills" ? auditSkillItemShape(values, required) : [];
    result.skillIssues.push(...skillIssues);
    const found = [];
    const missing = [];
    for (const skill of required) {
      const covered = section === "experience"
        ? values.some((value) => hasContextualBoldExperiencePlacement(value, skill))
        : values.includes(`**${skill.name}**`);
      if (covered) found.push(skill.name);
      else {
        missing.push(skill.name);
        result.missing.push({ skillId: skill.id, skill: skill.name, section });
      }
    }
    const forbidden = [
      ...excluded.map((skill) => ({ ...skill, reason: "excluded" })),
      ...(section === "experience"
        ? contract.skills
          .filter((skill) => !skill.allowedPlacements.includes("experience"))
          .map((skill) => ({
            id: skill.id,
            name: skill.name,
            reason: skill.decision === "familiar" ? "familiar-only" : "experience-not-permitted",
          }))
        : []),
    ];
    const violations = forbidden.filter((skill) => (
      values.some((value) => textContainsCoverageSkill(value, skill))
    ));
    result.violations.push(...violations.map((skill) => ({
      skillId: skill.id,
      skill: skill.name,
      section,
      reason: skill.reason,
    })));
    result.requiredCount += required.length;
    result.coveredCount += found.length;
    result.sections[section] = {
      required: required.map((skill) => skill.name),
      found,
      missing,
      forbidden: violations.map((skill) => skill.name),
      issues: skillIssues,
      incompleteRoles: section === "experience"
        ? result.careerIssues.map((issue) => issue.company || issue.title || `#${issue.index + 1}`)
        : [],
      passed: missing.length === 0
        && violations.length === 0
        && skillIssues.length === 0
        && (section !== "experience" || result.careerIssues.length === 0),
    };
  }
  result.experienceIssues = auditExperienceKeywordUse(sections?.experience, contract);
  if (result.experienceIssues.length && result.sections.experience) {
    result.sections.experience.issues = [
      ...(result.sections.experience.issues || []),
      ...result.experienceIssues,
    ];
    result.sections.experience.passed = false;
  }
  result.passed = result.missing.length === 0
    && result.violations.length === 0
    && result.skillIssues.length === 0
    && result.experienceIssues.length === 0
    && result.careerIssues.length === 0;
  return result;
}

export function resumeCoveragePrompt(rawContract) {
  const contract = normalizeResumeCoverageContract(rawContract);
  if (!contract) return "";
  const skills = contract.skills.filter((skill) => skill.requiredPlacements.includes("skills"));
  const experience = contract.skills.filter((skill) => skill.requiredPlacements.includes("experience"));
  const optionalExperience = contract.skills.filter((skill) => (
    skill.allowedPlacements.includes("experience")
    && !skill.requiredPlacements.includes("experience")
  ));
  const familiar = contract.skills.filter((skill) => skill.decision === "familiar");
  const excluded = contract.excluded.map((item) => cleanString(item?.name)).filter(Boolean);
  const evidenceLines = contract.skills
    .filter((skill) => skill.allowedPlacements.includes("experience"))
    .map((skill) => {
      const roles = (skill.evidence || []).map((item) => {
        const index = Number.isInteger(item.roleIndex) ? `role #${item.roleIndex + 1}` : "profile role";
        return [index, item.title, item.company].filter(Boolean).join(" ");
      });
      return `${skill.name}: ${roles.join("; ") || "candidate-confirmed; use in one suitable role only"}`;
    });
  return [
    "RESUME COVERAGE INSTRUCTIONS — use these requested placements while generating the structured sections.",
    `Skills section closed set (exact canonical names, each bolded once): ${skills.map((skill) => skill.name).join(", ") || "none"}`,
    `Required Experience terms (each needs one primary, evidence-grounded bullet): ${experience.map((skill) => skill.name).join(", ") || "none"}`,
    optionalExperience.length
      ? `Optional Used terms permitted in Experience only where their role evidence supports them: ${optionalExperience.map((skill) => skill.name).join(", ")}.`
      : "",
    evidenceLines.length ? `Experience role evidence:\n${evidenceLines.join("\n")}` : "",
    familiar.length ? `Familiar-only terms: ${familiar.map((skill) => skill.name).join(", ")}. These may appear in Skills but must not be claimed in Experience.` : "",
    excluded.length ? `Excluded terms: ${excluded.join(", ")}. Do not add these to the resume.` : "",
    "For every assigned placement, use the exact canonical spelling and wrap its first meaningful occurrence exactly as **Canonical Skill Name**.",
    "In Skills, return exactly one standalone item per assigned term, formatted only as **Canonical Skill Name**. Add no descriptions, compound items, repeated terms, subcategory items, or other skills; category labels are grouping labels only.",
    "In Experience, put target skills only inside complete, credible bullets. Each placement must connect a concrete task or workflow, the skill's technical function, and a practical purpose.",
    "Prefer zero to two target skills per Experience bullet and never more than three. Do not mention one skill in more than two bullets within a role.",
    "A candidate-confirmed skill without profile-role evidence may appear in one suitable role only. Never use a standalone keyword-list bullet, and never infer related products, projects, metrics, ownership, or achievements.",
  ].filter(Boolean).join("\n");
}

export function resumeCoverageRepairPrompt({
  purpose,
  missing,
  remove,
  skillIssues,
  experienceIssues,
  incompleteRoles,
  currentSection,
  schema,
}) {
  const names = Array.isArray(missing) ? missing.map(cleanString).filter(Boolean) : [];
  const removals = Array.isArray(remove) ? remove.map(cleanString).filter(Boolean) : [];
  const skillsProblems = Array.isArray(skillIssues) ? skillIssues : [];
  const experienceProblems = Array.isArray(experienceIssues) ? experienceIssues : [];
  const roles = Array.isArray(incompleteRoles) ? incompleteRoles : [];
  const instructions = purpose === "experience"
    ? [
        "Place each missing term inside the most credible existing role and a complete Experience bullet.",
        "Use the exact canonical spelling wrapped exactly as **Canonical Skill Name**.",
        "Each changed bullet must describe a concrete task or workflow, the skill's technical function, and its practical purpose.",
        "Prefer zero to two target skills per bullet and never more than three. Keep a skill in no more than two bullets within one role.",
        "For repeated or unsupported placements, preserve the strongest evidence-grounded occurrence and remove the redundant keyword. Reduce unsupported filler bullets instead of inventing replacement content.",
        "Do not append a keyword list or invent technologies, projects, metrics, ownership, or achievements.",
      ]
    : [
        "Treat the Skills coverage contract as a closed set: include every assigned term exactly once and include no other skill items.",
        "Every items array entry must be one standalone term formatted only as **Canonical Skill Name**.",
        "Remove descriptions, comma-separated or compound lists, repeated terms, and subcategory items. Category labels are grouping labels only.",
        "If a canonical term is already present but malformed or repeated, correct it in place instead of adding another copy.",
      ];
  return [
    `The generated ${purpose} section failed the deterministic coverage and formatting gate.`,
    `Required additions or formatting corrections: ${names.join(", ") || "none"}`,
    `Forbidden terms to remove from this section: ${removals.join(", ") || "none"}`,
    skillsProblems.length
      ? `Skills structure problems to correct:\n${skillsProblems.map((issue) => {
          if (issue?.reason === "duplicate-skill") return `${cleanString(issue.skill)} appears ${Number(issue.count) || 2} times`;
          return `${cleanString(issue?.reason)}: ${cleanString(issue?.item)}`;
        }).join("\n")}`
      : "",
    experienceProblems.length
      ? `Experience keyword problems to correct:\n${experienceProblems.map((issue) => {
          const role = Number.isInteger(issue?.roleIndex) ? `role #${issue.roleIndex + 1}` : "multiple roles";
          if (issue?.reason === "keyword-density") return `${role} bullet #${Number(issue.bulletIndex) + 1} contains too many target skills: ${(issue.skills || []).join(", ")}`;
          if (issue?.reason === "repeated-skill") return `${cleanString(issue.skill)} appears ${Number(issue.count)} times in ${role}`;
          if (issue?.reason === "unsupported-role-placement") return `${cleanString(issue.skill)} appears in unsupported ${role}`;
          if (issue?.reason === "unsupported-role-spread") return `${cleanString(issue.skill)} is spread across roles without independent evidence`;
          return cleanString(issue?.reason);
        }).join("\n")}`
      : "",
    roles.length
      ? `Authoritative roles requiring substantive bullets:\n${roles.map((role) => {
          const identity = [
            `#${Number(role?.index) + 1}`,
            cleanString(role?.title),
            cleanString(role?.company) ? `@ ${cleanString(role.company)}` : "",
            cleanString(role?.period) ? `(${cleanString(role.period)})` : "",
          ].filter(Boolean).join(" ");
          const description = cleanString(role?.description);
          return description ? `${identity} — ${description}` : identity;
        }).join("\n")}`
      : "",
    ...instructions,
    roles.length
      ? "Return exactly one Experience object per authoritative profile role, in the same order. Give every listed role at least one substantive bullet. When a role has a description, ground its bullets in that description. When it is blank, use only the authoritative role identity and confirmed Used skills, keep the wording conservative and non-quantified, and do not invent employer-specific facts, achievements, projects, internal systems, scope, or ownership."
      : "",
    "Remove every forbidden term without replacing it with a synonym or implying hands-on use elsewhere in the section.",
    "Rewrite only this section. Preserve all correct content, employer names, dates, chronology, and factual boundaries.",
    `Current ${purpose} JSON:\n${JSON.stringify(currentSection ?? {}, null, 2)}`,
    schema ? `Return only JSON conforming to this schema:\n${JSON.stringify(schema)}` : "Return only the corrected JSON object.",
  ].filter(Boolean).join("\n\n");
}

export { RESUME_COVERAGE_ANALYSIS_PROMPT };
