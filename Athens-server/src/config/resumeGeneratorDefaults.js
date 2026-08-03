/** Default resume-generator config when none is saved (mirrors Athens defaults.ts). */

const PURPOSES = ["summary", "skills", "experience"];
const SECTION_LABEL = { summary: "Summary", skills: "Skills", experience: "Experience" };

/** Exact default used before dynamic titles became a saved, tier-independent preference. */
export const LEGACY_TIERED_EXPERIENCE_PROMPT =
  "Rewrite each work experience into strong, quantified, action-oriented bullet points tailored to the target role. Job titles follow server policy: Beta accounts may use concise JD-aligned titles with a plausible career progression; all other accounts keep Profile Settings titles exactly. Return JSON matching the schema.";

function defaultSchemaFor(purpose) {
  switch (purpose) {
    case "summary":
      return JSON.stringify(
        { type: "object", properties: { summary: { type: "string" } }, required: ["summary"], additionalProperties: false },
        null,
        2,
      );
    case "skills":
      return JSON.stringify(
        {
          type: "object",
          properties: {
            skills: {
              type: "array",
              items: {
                type: "object",
                properties: { category: { type: "string" }, items: { type: "array", items: { type: "string" } } },
                required: ["category", "items"],
              },
            },
          },
          required: ["skills"],
          additionalProperties: false,
        },
        null,
        2,
      );
    case "experience":
      return JSON.stringify(
        {
          type: "object",
          properties: {
            experiences: {
              type: "array",
              minItems: 1,
              items: {
                type: "object",
                properties: {
                  company: { type: "string" },
                  title: { type: "string" },
                  period: { type: "string" },
                  bullets: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
                },
                required: ["company", "title", "bullets"],
              },
            },
          },
          required: ["experiences"],
          additionalProperties: false,
        },
        null,
        2,
      );
    default:
      return "{}";
  }
}

function defaultPromptFor(purpose, kind) {
  if (kind === "fine-tune") {
    if (purpose === "experience") {
      return `TARGET SKILLS FROM SKILL COVERAGE:
{job_skills}

Create an internal placement plan for Work Experience; do not write final résumé bullets. For every coverage-contract term assigned to Experience, choose the most credible career entry, a concrete workflow, its technical function, and its practical purpose. State any term that cannot be placed truthfully. Distribute terms across appropriate roles and avoid repeating the same workflow. Return only the placement plan.`;
    }
    return `Refine the ${SECTION_LABEL[purpose].toLowerCase()} draft for clarity, relevance, and factual restraint. Preserve every exact bold placement required by the coverage contract and do not add unsupported claims. Return only the improved draft.`;
  }
  switch (purpose) {
    case "summary":
      return "Write a concise 2–3 sentence professional summary tailored to the target role. Synthesize only facts supported by the career profile and confirmed coverage contract; do not turn familiar-only terms into hands-on claims or stuff the summary with keywords. Return only JSON matching the schema.";
    case "skills":
      return `TARGET SKILLS FROM SKILL COVERAGE:
{job_skills}

Build a concise ATS-friendly Skills section from the coverage contract. Include every term assigned to Skills exactly once, using its exact canonical spelling wrapped as **Canonical Skill Name**. Group items into clear categories, omit excluded terms, and add no unsupported technologies. Return only JSON matching the schema.`;
    case "experience":
      return `TARGET SKILLS FROM SKILL COVERAGE:
{job_skills}

Write the final Work Experience section using the candidate profile, any preceding placement plan, and the coverage contract. Preserve employers, dates, chronology, and the supplied career-title policy; job titles follow the saved Dynamic career titles preference. Use varied, concise bullets that describe a concrete task or workflow, how a confirmed skill served a technical function, and the practical purpose. Include every term assigned to Experience with its exact canonical spelling and bold its first meaningful occurrence as **Canonical Skill Name**. Prefer one or two target skills per bullet. Never place familiar-only or excluded terms in Experience, create keyword-list bullets, or invent technologies, projects, metrics, ownership, or achievements. Return only JSON matching the schema.`;
    default:
      return "";
  }
}

const DEFAULT_SYSTEM_INSTRUCTION = `You are a senior résumé writer and ATS optimization specialist.
- The candidate profile is authoritative for employers, dates, titles, education, career history, responsibilities, and achievements. Never invent facts.
- The supplied Skill Coverage contract is mandatory and authoritative for canonical names, decisions, and placements.
- Used terms may appear only in their assigned sections. Familiar-only terms may appear in Skills but never as hands-on Experience. Excluded terms must be omitted.
- Every required placement must use the exact canonical spelling and bold its first meaningful occurrence exactly as **Canonical Skill Name**.
- In Experience, integrate each required term into credible work that connects a concrete task or workflow, the skill's technical function, and a practical purpose. Prefer one or two target terms per bullet; never create keyword-list bullets.
- Do not infer related technologies, products, projects, metrics, ownership, internal names, or achievements.
- Final steps return only JSON conforming to the supplied schema. Planning steps return only the requested planning output.
- Maintain a concise, natural, professional, ATS-friendly voice across the résumé.`;

const defaultTheme = () => ({
  font: "Georgia",
  baseSize: 10.5,
  nameSize: 24,
  titleSize: 12,
  accent: "#1f3a5f",
  text: "#1a1a1a",
  headerAlign: "center",
  paper: "letter",
  margin: 0.6,
});

const finalStep = (purpose) => ({
  id: `default-${purpose}`,
  purpose,
  kind: "final",
  name: `${SECTION_LABEL[purpose]} (final)`,
  prompt: defaultPromptFor(purpose, "final"),
  schema: defaultSchemaFor(purpose),
});

export function defaultGeneratorConfig() {
  const theme = defaultTheme();
  return {
    schemaVersion: 3,
    provider: "openai",
    model: "gpt-5-nano",
    reasoningEffort: "low",
    dynamicCareerTitles: false,
    templateId: "classic",
    theme,
    layout: [
      { id: "summary", type: "summary", title: "Professional Summary", titleColor: theme.accent, titleSize: theme.titleSize, bodySize: theme.baseSize },
      { id: "skills", type: "skills", title: "Skills", titleColor: theme.accent, titleSize: theme.titleSize, bodySize: theme.baseSize },
      { id: "experience", type: "experience", title: "Experience", titleColor: theme.accent, titleSize: theme.titleSize, bodySize: theme.baseSize },
      { id: "education", type: "education", title: "Education", titleColor: theme.accent, titleSize: theme.titleSize, bodySize: theme.baseSize },
    ],
    systemInstruction: DEFAULT_SYSTEM_INSTRUCTION,
    steps: PURPOSES.map((p) => finalStep(p)),
    coverage: {
      enabled: true,
      experienceRequirementThreshold: 4,
      maxRepairAttempts: 1,
      aliases: {},
    },
  };
}

function isValidJson(text) {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/** Convert saved generator steps into the API request plan (parse JSON schemas). */
export function stepsToPlan(steps) {
  return (Array.isArray(steps) ? steps : []).map((s, i) => ({
    index: i + 1,
    purpose: s.purpose,
    kind: s.kind,
    name: s.name,
    prompt: s.prompt,
    ...(s.kind === "final"
      ? { schema: typeof s.schema === "string" && isValidJson(s.schema) ? JSON.parse(s.schema) : s.schema }
      : {}),
  }));
}
