import { createHash } from "node:crypto";
import { STATIC_ALIASES, toCanonical } from "@nextoffer/shared/skill-normalize";
import { chatCompletion } from "./llm/llmService.js";
import { reasoningEffortForExtraction } from "./jobSkillExtraction/aiExtractService.js";
import { normalizeCoverageSettings } from "./resumeGeneratorConfigSchema.js";

export const RESUME_COVERAGE_ANALYSIS_VERSION = 2;
export const RESUME_COVERAGE_CONTRACT_VERSION = 1;
export const RESUME_COVERAGE_AUDIT_VERSION = 1;

const CATEGORIES = new Set(["language", "framework", "platform", "protocol", "data", "cloud", "tool", "method", "domain"]);
const DECISIONS = new Set(["used", "familiar", "exclude"]);
const PLACEMENTS = new Set(["skills", "experience"]);

const RESUME_COVERAGE_ANALYSIS_PROMPT = `You are building a truthful ledger of concrete, named technologies from a job description.

Read the entire posting. Extract every explicit proper technology name, product name, standard, protocol, acronym, language, framework, library, platform, vendor product, database, or named file/data format that a candidate could list by its exact name on a resume.

A valid item is the shortest atomic canonical name supported by the posting's literal text. A capability, activity, architecture idea, or common-noun phrase is not a valid item.

Rules:
1. Do not infer a typical stack. Every item must be grounded in literal words from the posting.
2. Include explicit named alternatives and examples (including names inside parentheses or “such as” lists). They will be verified separately; do not silently discard named products.
3. Split a list of names into distinct atomic items rather than returning the list as one item.
4. Preserve canonical casing, punctuation, and abbreviation spelling. Never title-case an ordinary phrase to make it look like a name.
5. Provide only genuine aliases, abbreviations, spelling variants, or singular/plural forms. Never add related technologies as aliases.
6. requirement is 5 for must-have/core/repeated terms, 4 for clearly required terms, 3 for relevant body terms, 2 for preferred/plus/example alternatives, and 1 for passing mentions. An example named inside a required capability, or repeated elsewhere, may still be 4–5.
7. sourceText must be a short verbatim phrase from the posting that contains the item.
8. Never output a common-noun capability, activity, architecture, or workflow phrase. If one contains one or more named technologies, output only those atomic names.
9. Exclude soft skills, the hiring company's name (unless it is also an explicitly required product), benefits, degrees, seniority, and years of experience.

Output ONLY JSON:
{
  "skills": [
    {
      "name": "canonical name",
      "aliases": ["genuine spelling variant"],
      "category": "language | framework | platform | protocol | data | cloud | tool | method | domain",
      "requirement": 1,
      "sourceText": "short verbatim evidence"
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
  experienceRequirementThreshold,
} = {}) {
  const parsed = parseJsonObject(content);
  const rows = Array.isArray(parsed?.skills) ? parsed.skills : [];
  const usedThreshold = normalizeCoverageSettings({ experienceRequirementThreshold }).experienceRequirementThreshold;
  const deduped = new Map();
  for (const row of rows.slice(0, 80)) {
    const name = cleanString(row?.name);
    if (!name) continue;
    const itemAliases = aliasesForCoverageSkill({ name, aliases: row?.aliases }, aliases);
    const candidate = { name, aliases: itemAliases };
    // The extraction model may canonicalize a name, but at least the name or one
    // of its genuine aliases must still be present in the supplied JD.
    if (!textContainsCoverageSkill(jobDescription, candidate, aliases)) continue;
    if (!isNamedResumeCoverageSkill(candidate, jobDescription, aliases)) continue;
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
        decision: evidence.length || skill.requirement >= usedThreshold ? "used" : "familiar",
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

function skillItemTexts(section) {
  const groups = Array.isArray(section?.skills) ? section.skills : [];
  return groups.flatMap((group) => (
    Array.isArray(group?.items) ? group.items.map(cleanString).filter(Boolean) : []
  ));
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
    const required = contract.skills.filter((skill) => skill.placements.includes(section));
    const values = section === "experience"
      ? experienceBulletTexts(sections?.experience)
      : skillItemTexts(sections?.skills);
    const found = [];
    const missing = [];
    for (const skill of required) {
      const covered = section === "experience"
        ? values.some((value) => hasContextualBoldExperiencePlacement(value, skill))
        : values.some((value) => textContainsBoldCoverageSkill(value, skill));
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
          .filter((skill) => skill.decision === "familiar")
          .map((skill) => ({ id: skill.id, name: skill.name, reason: "familiar-only" }))
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
      incompleteRoles: section === "experience"
        ? result.careerIssues.map((issue) => issue.company || issue.title || `#${issue.index + 1}`)
        : [],
      passed: missing.length === 0
        && violations.length === 0
        && (section !== "experience" || result.careerIssues.length === 0),
    };
  }
  result.passed = result.missing.length === 0
    && result.violations.length === 0
    && result.careerIssues.length === 0;
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
    `Skills section (exact canonical names, each bolded once): ${skills.map((skill) => skill.name).join(", ") || "none"}`,
    `Experience section (candidate-used; exact canonical names in credible bullets): ${experience.map((skill) => skill.name).join(", ") || "none"}`,
    familiar.length ? `Familiar-only terms: ${familiar.map((skill) => skill.name).join(", ")}. These may appear in Skills but must not be claimed in Experience.` : "",
    excluded.length ? `Excluded terms: ${excluded.join(", ")}. Do not add these to the resume.` : "",
    "For every assigned placement, use the exact canonical spelling and wrap its first meaningful occurrence exactly as **Canonical Skill Name**.",
    "In Experience, put target skills only inside complete, credible bullets. Each placement must connect a concrete task or workflow, the skill's technical function, and a practical purpose.",
    "Prefer one or two target skills per Experience bullet. Never use a standalone keyword-list bullet, and never infer related products, projects, metrics, ownership, or achievements.",
  ].filter(Boolean).join("\n");
}

export function resumeCoverageRepairPrompt({
  purpose,
  missing,
  remove,
  incompleteRoles,
  currentSection,
  schema,
}) {
  const names = Array.isArray(missing) ? missing.map(cleanString).filter(Boolean) : [];
  const removals = Array.isArray(remove) ? remove.map(cleanString).filter(Boolean) : [];
  const roles = Array.isArray(incompleteRoles) ? incompleteRoles : [];
  const instructions = purpose === "experience"
    ? [
        "Place each missing term inside the most credible existing role and a complete Experience bullet.",
        "Use the exact canonical spelling wrapped exactly as **Canonical Skill Name**.",
        "Each changed bullet must describe a concrete task or workflow, the skill's technical function, and its practical purpose.",
        "Prefer one or two target skills per bullet. Do not append a keyword list or invent technologies, projects, metrics, ownership, or achievements.",
      ]
    : [
        "Place each missing term once as an item in the most appropriate Skills category.",
        "Use the exact canonical spelling wrapped exactly as **Canonical Skill Name**.",
        "If the canonical term is already present but unbolded, fix that item instead of duplicating it.",
      ];
  return [
    `The generated ${purpose} section failed the deterministic coverage and formatting gate.`,
    `Required additions or formatting corrections: ${names.join(", ") || "none"}`,
    `Forbidden terms to remove from this section: ${removals.join(", ") || "none"}`,
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
      ? "Return exactly one Experience object per authoritative profile role, in the same order. Give every listed role at least one substantive bullet grounded only in that role's profile description; do not transfer duties, skills, or achievements from another employer."
      : "",
    "Remove every forbidden term without replacing it with a synonym or implying hands-on use elsewhere in the section.",
    "Rewrite only this section. Preserve all correct content, employer names, dates, chronology, and factual boundaries.",
    `Current ${purpose} JSON:\n${JSON.stringify(currentSection ?? {}, null, 2)}`,
    schema ? `Return only JSON conforming to this schema:\n${JSON.stringify(schema)}` : "Return only the corrected JSON object.",
  ].filter(Boolean).join("\n\n");
}

export { RESUME_COVERAGE_ANALYSIS_PROMPT };
