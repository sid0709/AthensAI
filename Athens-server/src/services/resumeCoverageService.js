import { createHash } from "node:crypto";
import { STATIC_ALIASES, toCanonical } from "@nextoffer/shared/skill-normalize";
import { chatCompletion } from "./llm/llmService.js";
import { reasoningEffortForExtraction } from "./jobSkillExtraction/aiExtractService.js";
import { normalizeCoverageSettings } from "./resumeGeneratorConfigSchema.js";

export const RESUME_COVERAGE_ANALYSIS_VERSION = 1;
export const RESUME_COVERAGE_CONTRACT_VERSION = 1;
export const RESUME_COVERAGE_AUDIT_VERSION = 1;

const CATEGORIES = new Set(["language", "framework", "platform", "protocol", "data", "cloud", "tool", "method", "domain"]);
const DECISIONS = new Set(["used", "familiar", "exclude"]);
const PLACEMENTS = new Set(["skills", "experience"]);

const RESUME_COVERAGE_ANALYSIS_PROMPT = `You are building an exhaustive, truthful resume keyword ledger from a job description.

Read the entire posting. Extract every explicit technical hiring term that a qualified candidate might need to address: named languages, frameworks, libraries, platforms, vendor products, protocols, API styles, authentication methods, data/file formats, integration methods, cloud products, databases, testing/deployment/observability tools, and concrete technical architecture or workflow capabilities.

Rules:
1. Do not infer a typical stack. Every item must be grounded in literal words from the posting.
2. Include explicit alternatives and examples (including names inside parentheses or “such as” lists). They will be verified separately; do not silently discard them.
3. Split lists into distinct terms: “JSON, XML, CSV, EDI” becomes four items.
4. Preserve the standard canonical spelling (Node.js, NetSuite, REST, OAuth, MCP servers).
5. Provide only genuine aliases, abbreviations, spelling variants, or singular/plural forms. Never add related technologies as aliases.
6. requirement is 5 for must-have/core/repeated terms, 4 for clearly required terms, 3 for relevant body terms, 2 for preferred/plus/example alternatives, and 1 for passing mentions. An example named inside a required capability, or repeated elsewhere, may still be 4–5.
7. sourceText must be a short verbatim phrase from the posting that contains the item.
8. Exclude generic soft skills, company names, benefits, degrees, seniority, and years of experience.

Output ONLY JSON:
{
  "skills": [
    {
      "name": "NetSuite",
      "aliases": ["Oracle NetSuite"],
      "category": "platform",
      "requirement": 4,
      "sourceText": "integrating ERP systems (NetSuite, Acumatica...)"
    }
  ]
}`;

const cleanString = (value) => String(value ?? "").trim();

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

function evidenceForSkill(identity, skill, aliases) {
  const careers = Array.isArray(identity?.careers) ? identity.careers : [];
  const evidence = [];
  for (const career of careers) {
    const text = [career?.title, career?.company, career?.description].map(cleanString).filter(Boolean).join(" — ");
    if (!textContainsCoverageSkill(text, skill, aliases)) continue;
    evidence.push({
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
    .update(JSON.stringify(skills.map(({ id, name, aliases, requirement }) => ({ id, name, aliases, requirement }))))
    .digest("hex");
}

/**
 * Parenthetical technology/example lists are where extraction models most often
 * drop alternatives (for example NetSuite in "ERP systems (NetSuite, …)").
 * Preserve every explicit list item deterministically, then let evidence review
 * decide whether the candidate may claim it.
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
      ) continue;
      const canonical = toCanonical(name);
      if (!canonical || seen.has(canonical)) continue;
      seen.add(canonical);
      candidates.push({ name, category: "method", requirement, sourceText: `(${inside})` });
    }
  }
  return candidates.slice(0, 60);
}

export function parseResumeCoverageAnalysis(content, { jobDescription, identity, aliases = {} } = {}) {
  const parsed = parseJsonObject(content);
  const rows = Array.isArray(parsed?.skills) ? parsed.skills : [];
  const deduped = new Map();
  for (const row of rows.slice(0, 80)) {
    const name = cleanString(row?.name);
    if (!name) continue;
    const itemAliases = aliasesForCoverageSkill({ name, aliases: row?.aliases }, aliases);
    const candidate = { name, aliases: itemAliases };
    // The extraction model may canonicalize a name, but at least the name or one
    // of its genuine aliases must still be present in the supplied JD.
    if (!textContainsCoverageSkill(jobDescription, candidate, aliases)) continue;
    const canonical = toCanonical(name);
    const requirement = Math.min(5, Math.max(1, Math.round(Number(row?.requirement)) || 3));
    const previous = deduped.get(canonical);
    if (previous && previous.requirement >= requirement) continue;
    deduped.set(canonical, {
      id: createHash("sha1").update(canonical).digest("hex").slice(0, 12),
      name,
      aliases: itemAliases.filter((alias) => alias.toLocaleLowerCase("en-US") !== name.toLocaleLowerCase("en-US")),
      category: CATEGORIES.has(row?.category) ? row.category : "tool",
      requirement,
      sourceText: cleanString(row?.sourceText).slice(0, 280),
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
    deduped.set(canonical, {
      id: createHash("sha1").update(canonical).digest("hex").slice(0, 12),
      ...candidate,
      aliases: itemAliases.filter((alias) => alias.toLocaleLowerCase("en-US") !== candidate.name.toLocaleLowerCase("en-US")),
    });
  }
  const skills = [...deduped.values()]
    .sort((left, right) => right.requirement - left.requirement || left.name.localeCompare(right.name))
    .map((skill) => {
      const evidence = evidenceForSkill(identity, skill, aliases);
      return {
        ...skill,
        evidenceStatus: evidence.length ? "verified" : "unverified",
        evidence,
        decision: evidence.length ? "used" : null,
      };
    });
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
    maxTokens: 4000,
    signal,
    messages: [
      { role: "system", content: RESUME_COVERAGE_ANALYSIS_PROMPT },
      { role: "user", content: `Analyze this job description:\n\n${description.slice(0, 20_000)}` },
    ],
  });
  const analysis = parseResumeCoverageAnalysis(response?.content, {
    jobDescription: description,
    identity,
    aliases,
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
    const placements = ["skills"];
    if (decision === "used" && requirement >= settings.experienceRequirementThreshold) placements.push("experience");
    skills.push({
      id: cleanString(item.id),
      name: cleanString(item.name),
      aliases: aliasesForCoverageSkill(item, settings.aliases),
      category: CATEGORIES.has(item.category) ? item.category : "tool",
      requirement,
      evidenceStatus: item.evidenceStatus === "verified" ? "verified" : "candidate-confirmed",
      decision,
      placements,
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

export function normalizeResumeCoverageContract(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (raw.analysis) return buildResumeCoverageContract(raw.analysis, raw.decisions, raw.settings);
  if (!Array.isArray(raw.skills)) return null;
  return {
    schemaVersion: RESUME_COVERAGE_CONTRACT_VERSION,
    sourceAnalysisFingerprint: cleanString(raw.sourceAnalysisFingerprint),
    experienceRequirementThreshold: Math.min(5, Math.max(1, Number(raw.experienceRequirementThreshold) || 4)),
    maxRepairAttempts: Math.min(2, Math.max(0, Number(raw.maxRepairAttempts) || 0)),
    skills: raw.skills.map((item) => ({
      id: cleanString(item?.id),
      name: cleanString(item?.name),
      aliases: aliasesForCoverageSkill(item),
      category: CATEGORIES.has(item?.category) ? item.category : "tool",
      requirement: Math.min(5, Math.max(1, Number(item?.requirement) || 3)),
      evidenceStatus: item?.evidenceStatus === "verified" ? "verified" : "candidate-confirmed",
      decision: item?.decision === "familiar" ? "familiar" : "used",
      placements: [...new Set((Array.isArray(item?.placements) ? item.placements : ["skills"])
        .filter((placement) => PLACEMENTS.has(placement)))],
    })).filter((item) => item.name && item.placements.length),
    excluded: Array.isArray(raw.excluded) ? raw.excluded : [],
    unresolved: Array.isArray(raw.unresolved) ? raw.unresolved : [],
  };
}

function sectionPayload(sections, section) {
  return JSON.stringify(sections?.[section] ?? "");
}

export function auditResumeCoverage(sections, rawContract) {
  const contract = normalizeResumeCoverageContract(rawContract);
  const result = {
    schemaVersion: RESUME_COVERAGE_AUDIT_VERSION,
    passed: true,
    requiredCount: 0,
    coveredCount: 0,
    sections: {},
    missing: [],
  };
  if (!contract) return result;
  for (const section of PLACEMENTS) {
    const required = contract.skills.filter((skill) => skill.placements.includes(section));
    const text = sectionPayload(sections, section);
    const found = [];
    const missing = [];
    for (const skill of required) {
      if (textContainsCoverageSkill(text, skill)) found.push(skill.name);
      else {
        missing.push(skill.name);
        result.missing.push({ skillId: skill.id, skill: skill.name, section });
      }
    }
    result.requiredCount += required.length;
    result.coveredCount += found.length;
    result.sections[section] = {
      required: required.map((skill) => skill.name),
      found,
      missing,
      passed: missing.length === 0,
    };
  }
  result.passed = result.missing.length === 0;
  return result;
}

export function resumeCoveragePrompt(rawContract) {
  const contract = normalizeResumeCoverageContract(rawContract);
  if (!contract) return "";
  const skills = contract.skills.filter((skill) => skill.placements.includes("skills"));
  const experience = contract.skills.filter((skill) => skill.placements.includes("experience"));
  const familiar = contract.skills.filter((skill) => skill.decision === "familiar");
  const excluded = contract.excluded.map((item) => cleanString(item?.name)).filter(Boolean);
  return [
    "RESUME COVERAGE CONTRACT — deterministic validation will enforce these exact placements.",
    `Skills section (exact canonical names): ${skills.map((skill) => skill.name).join(", ") || "none"}`,
    `Experience section (candidate-used; place naturally in credible bullets): ${experience.map((skill) => skill.name).join(", ") || "none"}`,
    familiar.length ? `Familiar-only terms: ${familiar.map((skill) => skill.name).join(", ")}. These may appear in Skills but must not be claimed in Experience.` : "",
    excluded.length ? `Excluded terms: ${excluded.join(", ")}. Do not add these to the resume.` : "",
    "Use the exact canonical spelling at least once in every assigned section. Do not satisfy the contract with keyword lists inside Experience; each term must describe concrete work.",
  ].filter(Boolean).join("\n");
}

export { RESUME_COVERAGE_ANALYSIS_PROMPT };
