import type { RefinementStep, ResumeTheme, SectionLayoutConfig } from "../../../types/resume";
import { DEFAULT_SECTIONS, DEFAULT_THEME } from "../../../data/resumes/seedDocument";

export type StepPurpose = "summary" | "skills" | "experience" | "education";
export type StepKind = "fine-tune" | "final";

export const PURPOSES: StepPurpose[] = ["summary", "skills", "experience"];
export const SECTION_LABEL: Record<StepPurpose | "education", string> = {
  summary: "Summary",
  skills: "Skills",
  experience: "Experience",
  education: "Education",
};

export const DEFAULT_SYSTEM_INSTRUCTION = `You are an expert resume writer. You will receive a candidate's profile and produce one resume across several steps.
- The candidate's facts are authoritative; never invent employers, dates, or credentials.
- Final steps return ONLY JSON conforming to the provided schema; fine-tuning steps return the improved draft.
- Maintain a consistent, professional, ATS-friendly tone across all steps.`;

export const FALLBACK_MODELS: Record<string, string[]> = {
  openai: ["gpt-5-nano", "gpt-5-mini", "gpt-4o-mini", "gpt-4o"],
  deepseek: ["deepseek-v4-flash", "deepseek-v4-pro"],
};

let _id = 0;
export const uid = () => `${Date.now().toString(36)}-${(_id++).toString(36)}`;

export function defaultSchemaFor(purpose: StepPurpose): string {
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
              items: {
                type: "object",
                properties: {
                  company: { type: "string" },
                  title: { type: "string" },
                  period: { type: "string" },
                  bullets: { type: "array", items: { type: "string" } },
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

export function defaultPromptFor(purpose: StepPurpose, kind: StepKind): string {
  if (kind === "fine-tune") {
    return `Refine the ${SECTION_LABEL[purpose].toLowerCase()} draft: tighten wording, remove fluff, and align it to the target role. Return the improved draft.`;
  }
  switch (purpose) {
    case "summary":
      return "Using the candidate profile and target role, write a 2–3 sentence professional summary. Return JSON matching the schema.";
    case "skills":
      return "Group the candidate's most relevant skills into labeled categories for the target role. Return JSON matching the schema.";
    case "experience":
      return "Rewrite each work experience into strong, quantified, action-oriented bullet points tailored to the target role. Return JSON matching the schema.";
    default:
      return "";
  }
}

const finalStep = (purpose: StepPurpose): RefinementStep => ({
  id: uid(),
  purpose,
  kind: "final",
  name: `${SECTION_LABEL[purpose]} (final)`,
  prompt: defaultPromptFor(purpose, "final"),
  schema: defaultSchemaFor(purpose),
});

export function defaultRefinementSteps(): RefinementStep[] {
  return PURPOSES.map((p) => finalStep(p));
}

export function ensureSteps(steps: RefinementStep[]): RefinementStep[] {
  const normalized = steps
    .filter((s) => PURPOSES.includes(s.purpose))
    .map((s) => (s.id ? s : { ...s, id: uid() }));
  for (const p of PURPOSES) {
    if (!normalized.some((s) => s.purpose === p && s.kind === "final")) {
      normalized.push(finalStep(p));
    }
  }
  return normalized;
}

export function stepsToApiPayload(steps: RefinementStep[]) {
  return steps.map((s, i) => ({
    index: i + 1,
    purpose: s.purpose,
    kind: s.kind,
    name: s.name,
    prompt: s.prompt,
    ...(s.kind === "final" && s.schema && isValidJson(s.schema) ? { schema: JSON.parse(s.schema) } : {}),
  }));
}

function isValidJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

export function defaultEditorTheme(): ResumeTheme {
  return { ...DEFAULT_THEME };
}

export function defaultEditorSections(): SectionLayoutConfig[] {
  return DEFAULT_SECTIONS.map((s) => ({ ...s }));
}
