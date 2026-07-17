/**
 * Shared career-title policy for résumé generation (Resume Editor, Job Search, Agent).
 * Beta: JD-aware concise titles with reconciliation. Non-Beta: exact Profile titles.
 */
import { createHash } from "node:crypto";

/** Bump when prompting, validation, or reconciliation rules change. */
export const TITLE_POLICY_VERSION = 1;

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

/** Concise conventional résumé title suitable for Beta acceptance. */
export function isAcceptableBetaTitle(title) {
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
export function buildExperienceTitleGuidance({ isBeta, jobDescription, careers }) {
  const list = Array.isArray(careers) ? careers : [];
  if (!isBeta) {
    return `

TITLE POLICY (mandatory — non-Beta):
- Keep each experience job title EXACTLY as given in the candidate profile / Profile Settings.
- Do not rename, rephrase, shorten, expand, or tailor titles to the job description.
- You may rewrite bullets only; company names and dates stay as given.`;
  }

  const jd = cleanString(jobDescription) || "(no job description provided)";
  const sequence = list.length
    ? formatAuthoritativeCareers(list)
    : "(no careers on profile)";

  return `

TITLE POLICY (mandatory — Beta):
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
- Propose one concise, conventional résumé title per role (e.g. "Senior Backend Engineer").
- Align specialization to that role's responsibilities and the target JD when supported by the experience.
- You may infer seniority freely, but the overall sequence must remain humanly plausible chronologically.
- Domain transitions (e.g. Java → backend → full stack, or data → AI) are allowed only when each role's experience supports them.
- PROHIBITED: slash or keyword stacking such as "Senior/Staff Backend/Java Engineer", pipe-joined titles, or comma-stuffed keyword lists.
- Preserve company names and dates from the authoritative sequence; rewrite bullets as usual.`;
}

/** Append title policy to an Experience final-step prompt (tokens already applied). */
export function appendExperienceTitlePolicy(prompt, { isBeta, jobDescription, careers }) {
  return `${cleanString(prompt)}${buildExperienceTitleGuidance({ isBeta, jobDescription, careers })}`;
}

function experienceListFromSection(section) {
  if (!section || typeof section !== "object") return [];
  if (Array.isArray(section.experiences)) return section.experiences;
  if (Array.isArray(section.experience)) return section.experience;
  return [];
}

/**
 * Reconcile model Experience JSON against Profile careers.
 * - Always preserve career count/order, company, and dates from Profile Settings.
 * - Non-Beta: titles are always the Profile titles.
 * - Beta: accept valid suggested titles; fall back to source for empty/malformed/stacked.
 * - Bullets (and optional location) come from the model when present.
 */
export function reconcileExperienceTitles(section, identity, isBeta) {
  const careers = sourceCareers(identity);
  const modelList = experienceListFromSection(section);

  const experiences = careers.map((career, i) => {
    const model = modelList[i] && typeof modelList[i] === "object" ? modelList[i] : {};
    const sourceTitle = cleanString(career?.title);
    let title = sourceTitle;
    if (isBeta) {
      const suggested = cleanString(model.title);
      if (isAcceptableBetaTitle(suggested)) title = suggested;
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
export function applyTitlePolicyToSections(sections, identity, isBeta) {
  if (!sections || typeof sections !== "object") return sections;
  if (!sections.experience) return sections;
  return {
    ...sections,
    experience: reconcileExperienceTitles(sections.experience, identity, Boolean(isBeta)),
  };
}

/** Slice of generator config that can affect titles / Experience output. */
export function titlePolicyConfigSlice(config) {
  const c = config && typeof config === "object" ? config : {};
  const steps = Array.isArray(c.steps) ? c.steps : [];
  return {
    systemInstruction: c.systemInstruction ?? null,
    experienceSteps: steps
      .filter((s) => s?.purpose === "experience")
      .map((s) => ({
        kind: s?.kind ?? null,
        prompt: s?.prompt ?? null,
      })),
  };
}

/**
 * Fingerprint for cache/reuse invalidation: policy version, Beta state, JD,
 * source careers, and relevant saved generator config.
 */
export function computeTitlePolicyFingerprint({
  isBeta,
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
    beta: Boolean(isBeta),
    jd: cleanString(jobDescription),
    careers: careerRows,
    config: titlePolicyConfigSlice(config),
  };
  return createHash("sha1").update(JSON.stringify(payload)).digest("hex");
}
