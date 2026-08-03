/**
 * Shared career-title policy for résumé generation (Resume Editor, Job Search, Agent).
 * Dynamic titles enabled: JD-aware concise titles. Disabled: exact Profile titles.
 */
import { createHash } from "node:crypto";

/** Bump when prompting, validation, reconciliation, or reuse rules change. */
export const TITLE_POLICY_VERSION = 4;

const cleanString = (v) => String(v ?? "").trim();

export function sourceCareers(identity) {
  return Array.isArray(identity?.careers) ? identity.careers : [];
}

/**
 * Slash/keyword stacking such as "Senior/Staff Backend/Java Engineer",
 * pipe-joined titles, or long keyword-list titles.
 */
export function isStackedOrMalformedTitle(title) {
  const t = cleanString(title);
  if (!t) return true;
  if (t.length > 80) return true;
  if (/[|/]/.test(t)) return true;
  // "Java, Python, React Engineer"-style keyword piles
  if ((t.match(/,/g) || []).length >= 2) return true;
  return false;
}

/** Concise conventional résumé title suitable for dynamic-title acceptance. */
export function isAcceptableDynamicTitle(title) {
  const t = cleanString(title);
  if (!t) return false;
  if (isStackedOrMalformedTitle(t)) return false;
  // Reject obvious multi-role dumps without slash (e.g. "Engineer and Manager and Lead")
  if ((t.match(/\band\b/gi) || []).length >= 2) return false;
  return true;
}

function formatAuthoritativeCareers(careers) {
  return careers
    .map((c, i) => {
      const parts = [
        `#${i + 1}`,
        cleanString(c?.title) || "(untitled)",
        cleanString(c?.company) ? `@ ${cleanString(c.company)}` : "",
        cleanString(c?.period) ? `(${cleanString(c.period)})` : "",
      ].filter(Boolean);
      const desc = cleanString(c?.description);
      return desc ? `${parts.join(" ")} — ${desc}` : parts.join(" ");
    })
    .join("\n");
}

/**
 * Mandatory Experience-step appendix. Enforced again in reconcileExperienceTitles.
 */
export function buildExperienceTitleGuidance({ dynamicCareerTitles, jobDescription, careers }) {
  const list = Array.isArray(careers) ? careers : [];
  if (!dynamicCareerTitles) {
    return `

TITLE POLICY (mandatory — dynamic career titles disabled):
- Keep each experience job title EXACTLY as given in the candidate profile / Profile Settings.
- Do not rename, rephrase, shorten, expand, or tailor titles to the job description.
- You may rewrite bullets only; company names and dates stay as given.
- Return every profile role in order with at least one substantive bullet grounded in that role's profile description.`;
  }

  const jd = cleanString(jobDescription) || "(no job description provided)";
  const sequence = list.length
    ? formatAuthoritativeCareers(list)
    : "(no careers on profile)";

  return `

TITLE POLICY (mandatory — dynamic career titles enabled):
Target job description:
<<<
${jd}
>>>

Authoritative career sequence from Profile Settings (preserve count, order, company, and dates):
<<<
${sequence}
>>>

Rules for job titles:
- Return exactly one experience object per role above, in the same order.
- Give every role at least one substantive bullet grounded in that role's own profile description.
- Propose one concise, conventional résumé title per role (e.g. "Senior Backend Engineer").
- Align specialization to that role's responsibilities and the target JD when supported by the experience.
- You may infer seniority freely, but the overall sequence must remain humanly plausible chronologically.
- Domain transitions (e.g. Java → backend → full stack, or data → AI) are allowed only when each role's experience supports them.
- PROHIBITED: slash or keyword stacking such as "Senior/Staff Backend/Java Engineer", pipe-joined titles, or comma-stuffed keyword lists.
- Preserve company names and dates from the authoritative sequence; rewrite bullets as usual.`;
}

/** Append title policy to an Experience final-step prompt (tokens already applied). */
export function appendExperienceTitlePolicy(prompt, { dynamicCareerTitles, jobDescription, careers }) {
  return `${cleanString(prompt)}${buildExperienceTitleGuidance({ dynamicCareerTitles, jobDescription, careers })}`;
}

function experienceListFromSection(section) {
  if (!section || typeof section !== "object") return [];
  if (Array.isArray(section.experiences)) return section.experiences;
  if (Array.isArray(section.experience)) return section.experience;
  return [];
}

function identityKey(value) {
  return cleanString(value)
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Reconcile model Experience JSON against Profile careers.
 * - Always preserve career count/order, company, and dates from Profile Settings.
 * - Dynamic titles disabled: titles are always the Profile titles.
 * - Dynamic titles enabled: accept valid suggestions; fall back for empty/malformed/stacked.
 * - Bullets (and optional location) come from the model when present.
 */
export function reconcileExperienceTitles(section, identity, dynamicCareerTitles) {
  const careers = sourceCareers(identity);
  const modelList = experienceListFromSection(section);
  const unusedModelRows = new Set(modelList.map((_, index) => index));
  const sourceCompanyKeys = new Set(careers.map((career) => identityKey(career?.company)).filter(Boolean));
  const hasAnyCompanyMatch = modelList.some((row) => sourceCompanyKeys.has(identityKey(row?.company)));

  const takeModelRow = (career, careerIndex) => {
    const companyKey = identityKey(career?.company);
    const periodKey = identityKey(career?.period);
    const companyMatches = [...unusedModelRows].filter((index) => (
      companyKey && identityKey(modelList[index]?.company) === companyKey
    ));
    if (companyMatches.length) {
      const periodMatch = companyMatches.find((index) => (
        periodKey && identityKey(modelList[index]?.period) === periodKey
      ));
      const index = periodMatch ?? companyMatches[0];
      unusedModelRows.delete(index);
      return modelList[index];
    }

    const positional = modelList[careerIndex];
    if (!unusedModelRows.has(careerIndex)) return {};
    const positionalCompany = identityKey(positional?.company);
    // When at least one model company is trustworthy, an explicitly different
    // company means this career was omitted; do not shift another role's bullets.
    if (positionalCompany && hasAnyCompanyMatch) return {};
    unusedModelRows.delete(careerIndex);
    return positional && typeof positional === "object" ? positional : {};
  };

  const experiences = careers.map((career, i) => {
    const model = takeModelRow(career, i);
    const sourceTitle = cleanString(career?.title);
    let title = sourceTitle;
    if (dynamicCareerTitles) {
      const suggested = cleanString(model.title);
      if (isAcceptableDynamicTitle(suggested)) title = suggested;
    }

    const bullets = Array.isArray(model.bullets)
      ? model.bullets.map((b) => cleanString(b)).filter(Boolean)
      : [];

    const row = {
      company: cleanString(career?.company) || cleanString(model.company),
      title,
      period: cleanString(career?.period) || cleanString(model.period),
      bullets,
    };
    const location = cleanString(model.location);
    if (location) row.location = location;
    return row;
  });

  return { experiences };
}

/** Apply title policy to a full sections object (mutates experience in place via replace). */
export function applyTitlePolicyToSections(sections, identity, dynamicCareerTitles) {
  if (!sections || typeof sections !== "object") return sections;
  if (!sections.experience) return sections;
  return {
    ...sections,
    experience: reconcileExperienceTitles(
      sections.experience,
      identity,
      Boolean(dynamicCareerTitles),
    ),
  };
}

/** Slice of generator config that can affect generated section content. */
export function titlePolicyConfigSlice(config) {
  const c = config && typeof config === "object" ? config : {};
  const steps = Array.isArray(c.steps) ? c.steps : [];
  return {
    provider: c.provider ?? null,
    model: c.model ?? null,
    reasoningEffort: c.reasoningEffort ?? null,
    systemInstruction: c.systemInstruction ?? null,
    steps: steps.map((s) => ({
        purpose: s?.purpose ?? null,
        kind: s?.kind ?? null,
        prompt: s?.prompt ?? null,
        schema: s?.schema ?? null,
      })),
    coverage: c.coverage?.settings ?? c.coverage ?? null,
  };
}

/**
 * Fingerprint for cache/reuse invalidation: policy version, saved preference, JD,
 * source careers, and relevant saved generator config.
 */
export function computeTitlePolicyFingerprint({
  dynamicCareerTitles,
  jobDescription,
  careers,
  config,
} = {}) {
  const careerRows = (Array.isArray(careers) ? careers : []).map((c) => ({
    title: cleanString(c?.title),
    company: cleanString(c?.company),
    period: cleanString(c?.period),
    description: cleanString(c?.description),
  }));
  const payload = {
    v: TITLE_POLICY_VERSION,
    dynamicCareerTitles: Boolean(dynamicCareerTitles),
    jd: cleanString(jobDescription),
    careers: careerRows,
    config: titlePolicyConfigSlice(config),
  };
  return createHash("sha1").update(JSON.stringify(payload)).digest("hex");
}
