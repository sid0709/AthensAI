/** Default resume-generator config when none is saved (mirrors Athens defaults.ts). */

const PURPOSES = ["summary", "skills", "experience"];
const SECTION_LABEL = { summary: "Summary", skills: "Skills", experience: "Experience" };

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

function defaultPromptFor() {
  return "";
}

const DEFAULT_SYSTEM_INSTRUCTION = "";

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
    schemaVersion: 4,
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
