import type { DropdownOption } from "../adapters/ui";
import {
  PURPOSES,
  RESUME_GENERATOR_CONFIG_VERSION,
  SECTION_LABEL,
  SECTION_TYPES,
  type GeneratorConfig,
  type GenStep,
  type LayoutSection,
  type ProviderId,
  type Purpose,
  type ReasoningEffort,
  type ResumeTheme,
  type ResumeCoverageSettings,
  type SectionType,
  type StepKind,
} from "../types";
import { MONO_FONT } from "./templates";

export const PROVIDER_OPTIONS: DropdownOption<ProviderId>[] = [
  { value: "openai", label: "OpenAI", hint: "gpt-*" },
  { value: "deepseek", label: "DeepSeek", hint: "deepseek-v4-*" },
];

export const REASONING_OPTIONS: DropdownOption<ReasoningEffort>[] = [
  { value: "default", label: "Default", hint: "don't send" },
  { value: "none", label: "none" },
  { value: "minimal", label: "minimal", hint: "nano only" },
  { value: "low", label: "low" },
  { value: "medium", label: "medium" },
  { value: "high", label: "high" },
  { value: "xhigh", label: "xhigh", hint: "newer only" },
];

export const FALLBACK_MODELS: Record<ProviderId, string[]> = {
  openai: ["gpt-5-nano", "gpt-5-mini", "gpt-5", "gpt-4o-mini", "gpt-4o"],
  deepseek: ["deepseek-v4-flash", "deepseek-v4-pro"],
};

const LEGACY_TIERED_EXPERIENCE_PROMPT =
  "Rewrite each work experience into strong, quantified, action-oriented bullet points tailored to the target role. Job titles follow server policy: Beta accounts may use concise JD-aligned titles with a plausible career progression; all other accounts keep Profile Settings titles exactly. Return JSON matching the schema.";

function migrateStoredSteps(steps: GenStep[]): GenStep[] {
  return steps.map((step) =>
    step.purpose === "experience"
    && step.kind === "final"
    && step.prompt.trim() === LEGACY_TIERED_EXPERIENCE_PROMPT
      ? { ...step, prompt: defaultPromptFor("experience", "final") }
      : step,
  );
}

/** Pick a model that belongs to the selected provider (e.g. reject gpt-* on DeepSeek). */
export function resolveModelForProvider(provider: ProviderId, savedModel: string | undefined): string {
  const fallbacks = FALLBACK_MODELS[provider];
  const model = savedModel?.trim();
  if (!model) return fallbacks[0];
  if (provider === "deepseek") return fallbacks.includes(model) ? model : fallbacks[0];
  if (model.startsWith("deepseek-")) return fallbacks[0];
  return model;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizeCoverageSettings(value: unknown): ResumeCoverageSettings {
  const raw = record(value);
  const threshold = Math.min(5, Math.max(1, Math.round(Number(raw.experienceRequirementThreshold) || 4)));
  const attempts = Math.min(2, Math.max(0, Math.round(Number(raw.maxRepairAttempts) || 0)));
  const aliases: Record<string, string[]> = {};
  for (const [name, values] of Object.entries(record(raw.aliases))) {
    if (!Array.isArray(values)) continue;
    const cleaned = [...new Set(values.map(String).map((item) => item.trim()).filter(Boolean))].slice(0, 20);
    if (cleaned.length) aliases[name] = cleaned;
  }
  return {
    enabled: raw.enabled !== false,
    experienceRequirementThreshold: threshold,
    maxRepairAttempts: raw.maxRepairAttempts == null ? 1 : attempts,
    aliases,
  };
}

function migrateLegacyTheme(value: unknown, base: ResumeTheme): ResumeTheme {
  const raw = record(value);
  return {
    ...base,
    font: typeof raw.font === "string" && raw.font ? raw.font : base.font,
    baseSize: Number(raw.baseSize ?? raw.bodySizePt) || base.baseSize,
    nameSize: Number(raw.nameSize ?? raw.nameSizePt) || base.nameSize,
    titleSize: Number(raw.titleSize) || base.titleSize,
    accent: String(raw.accent ?? raw.accentColor ?? base.accent),
    text: String(raw.text ?? raw.textColor ?? base.text),
    headerAlign: raw.headerAlign === "left" ? "left" : "center",
    paper: raw.paper === "a4" || raw.paperSize === "a4" ? "a4" : "letter",
    margin: Number(raw.margin ?? raw.marginIn) || base.margin,
  };
}

function migrateLegacyLayout(raw: Record<string, unknown>, theme: ResumeTheme, base: LayoutSection[]): LayoutSection[] {
  if (Array.isArray(raw.layout) && raw.layout.length) return raw.layout as LayoutSection[];
  if (!Array.isArray(raw.sections) || !raw.sections.length) return base;
  return raw.sections
    .map(record)
    .sort((left, right) => Number(left.order ?? 0) - Number(right.order ?? 0))
    .map((section, index) => {
      const type = String(section.type ?? section.id ?? "") as SectionType;
      if (!SECTION_TYPES.includes(type)) return null;
      return {
        id: String(section.id ?? `${type}-${index}`),
        type,
        title: String(section.title ?? SECTION_LABEL[type]),
        titleColor: String(section.titleColor ?? section.color ?? theme.accent),
        titleSize: Number(section.titleSize ?? section.titleSizePt) || theme.titleSize,
        bodySize: Number(section.bodySize ?? section.bodySizePt) || theme.baseSize,
      } satisfies LayoutSection;
    })
    .filter((section): section is LayoutSection => section != null);
}

/** Merge legacy v1/v2 or canonical v3 persistence onto runtime defaults. */
export function mergeStoredConfig(parsed: unknown): GeneratorConfig {
  const base = defaultConfig();
  const envelope = record(parsed);
  const raw = envelope.settings || envelope.presentation
    ? { ...record(envelope.settings), ...record(envelope.presentation) }
    : envelope;
  const provider: ProviderId = raw.provider === "deepseek" ? "deepseek" : "openai";
  const theme = migrateLegacyTheme(raw.theme, base.theme);
  const savedSteps = Array.isArray(raw.steps)
    ? raw.steps
    : Array.isArray(raw.refinementSteps)
      ? raw.refinementSteps
      : [];
  return ensurePurposes({
    schemaVersion: RESUME_GENERATOR_CONFIG_VERSION,
    provider,
    model: resolveModelForProvider(provider, typeof raw.model === "string" ? raw.model : base.model),
    reasoningEffort: typeof raw.reasoningEffort === "string" ? raw.reasoningEffort as ReasoningEffort : base.reasoningEffort,
    dynamicCareerTitles: raw.dynamicCareerTitles === true,
    templateId: typeof raw.templateId === "string" ? raw.templateId : base.templateId,
    uploadedTemplate: record(raw.uploadedTemplate).id ? raw.uploadedTemplate as GeneratorConfig["uploadedTemplate"] : undefined,
    theme,
    layout: migrateLegacyLayout(raw, theme, base.layout),
    systemInstruction: typeof raw.systemInstruction === "string" ? raw.systemInstruction : base.systemInstruction,
    jobDescription: typeof raw.jobDescription === "string" ? raw.jobDescription : "",
    steps: savedSteps.length
      ? migrateStoredSteps(savedSteps as GenStep[])
      : base.steps,
    coverage: normalizeCoverageSettings(raw.coverage),
  });
}

/** The reusable v3 config intentionally excludes transient ApplicationRun data. */
export function serializeStoredConfig(config: GeneratorConfig) {
  const { jobDescription: _jobDescription, ...stored } = config;
  return { ...stored, schemaVersion: RESUME_GENERATOR_CONFIG_VERSION };
}

const SERIF_FONTS = new Set(["Georgia", "Times New Roman", "Garamond", "Cambria", "Source Serif 4", "Merriweather", "Lora", "PT Serif"]);
const MONO_FONTS = new Set(["Roboto Mono", "JetBrains Mono"]);

// Turn a chosen font name into a CSS font stack with a sensible generic fallback,
// quoting multi-word families. Values that are already a full stack (MONO_FONT)
// pass through unchanged.
export function fontStack(name: string): string {
  if (!name) return "sans-serif";
  if (name.includes(",")) return name;
  const generic = MONO_FONTS.has(name) ? "monospace" : SERIF_FONTS.has(name) ? "serif" : "sans-serif";
  const quoted = /\s/.test(name) ? `"${name}"` : name;
  return `${quoted}, ${generic}`;
}

export const FONT_OPTIONS: DropdownOption<string>[] = [
  // Google fonts (loaded as web fonts — render everywhere, no install needed)
  ...["Inter", "Source Sans 3", "Roboto", "Open Sans", "Lato", "Source Serif 4", "Merriweather", "Lora", "PT Serif"].map((f) => ({
    value: f,
    label: f,
  })),
  // System fonts (no network; render only where the font is installed)
  ...["Georgia", "Times New Roman", "Garamond", "Cambria", "Arial", "Helvetica", "Calibri"].map((f) => ({
    value: f,
    label: `${f} (system)`,
  })),
  { value: "Roboto Mono", label: "Roboto Mono" },
  { value: "JetBrains Mono", label: "JetBrains Mono" },
  { value: MONO_FONT, label: "Monospace (system)" },
];

export const PALETTES: { name: string; accent: string; text: string }[] = [
  { name: "Navy", accent: "#1f3a5f", text: "#1a1a1a" },
  { name: "Emerald", accent: "#0f766e", text: "#111827" },
  { name: "Burgundy", accent: "#7b1e3b", text: "#1a1a1a" },
  { name: "Royal", accent: "#4338ca", text: "#1f2937" },
  { name: "Slate", accent: "#334155", text: "#0f172a" },
  { name: "Teal", accent: "#0e7490", text: "#0f172a" },
  { name: "Plum", accent: "#6d28d9", text: "#1f2937" },
  { name: "Charcoal", accent: "#111827", text: "#111827" },
];

export function defaultSchemaFor(purpose: Purpose): string {
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
  }
}

export function defaultPromptFor(purpose: Purpose, kind: StepKind): string {
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
  }
}

export const DEFAULT_SYSTEM_INSTRUCTION = `You are a senior résumé writer and ATS optimization specialist.
- The candidate profile is authoritative for employers, dates, titles, education, career history, responsibilities, and achievements. Never invent facts.
- The supplied Skill Coverage contract is mandatory and authoritative for canonical names, decisions, and placements.
- Used terms may appear only in their assigned sections. Familiar-only terms may appear in Skills but never as hands-on Experience. Excluded terms must be omitted.
- Every required placement must use the exact canonical spelling and bold its first meaningful occurrence exactly as **Canonical Skill Name**.
- In Experience, integrate each required term into credible work that connects a concrete task or workflow, the skill's technical function, and a practical purpose. Prefer one or two target terms per bullet; never create keyword-list bullets.
- Do not infer related technologies, products, projects, metrics, ownership, internal names, or achievements.
- Final steps return only JSON conforming to the supplied schema. Planning steps return only the requested planning output.
- Maintain a concise, natural, professional, ATS-friendly voice across the résumé.`;

let _id = 0;
export const uid = () => `${Date.now().toString(36)}-${(_id++).toString(36)}`;

const finalStep = (purpose: Purpose): GenStep => ({
  id: uid(),
  purpose,
  kind: "final",
  name: `${SECTION_LABEL[purpose]} (final)`,
  prompt: defaultPromptFor(purpose, "final"),
  schema: defaultSchemaFor(purpose),
});

export const defaultTheme = (): ResumeTheme => ({
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

const SECTION_TITLE: Record<SectionType, string> = {
  summary: "Professional Summary",
  skills: "Skills",
  experience: "Experience",
  education: "Education",
};

const defaultSection = (type: SectionType, theme: ResumeTheme): LayoutSection => ({
  id: uid(),
  type,
  title: SECTION_TITLE[type],
  titleColor: theme.accent,
  titleSize: theme.titleSize,
  bodySize: theme.baseSize,
});

export const defaultConfig = (): GeneratorConfig => {
  const theme = defaultTheme();
  return {
    schemaVersion: RESUME_GENERATOR_CONFIG_VERSION,
    provider: "openai",
    model: "gpt-5-nano",
    reasoningEffort: "low",
    dynamicCareerTitles: false,
    templateId: "classic",
    theme,
    layout: SECTION_TYPES.map((t) => defaultSection(t, theme)),
    systemInstruction: DEFAULT_SYSTEM_INSTRUCTION,
    jobDescription: "",
    steps: PURPOSES.map((p) => finalStep(p)),
    coverage: {
      enabled: true,
      experienceRequirementThreshold: 4,
      maxRepairAttempts: 1,
      aliases: {},
    },
  };
};

// Migrate a restored config so every section type has a layout entry and every
// AI purpose has a final step. (Education is layout-only — from the profile.)
export function ensurePurposes(cfg: GeneratorConfig): GeneratorConfig {
  const layout = cfg.layout.map((s) => (s.id ? s : { ...s, id: uid() }));
  for (const t of SECTION_TYPES) {
    if (!layout.some((s) => s.type === t)) layout.push(defaultSection(t, cfg.theme));
  }
  const steps = cfg.steps
    .filter((s) => (PURPOSES as string[]).includes(s.purpose))
    .map((s) => (s.id ? s : { ...s, id: uid() }));
  for (const p of PURPOSES) {
    if (!steps.some((s) => s.purpose === p && s.kind === "final")) steps.push(finalStep(p));
  }
  return { ...cfg, layout, steps };
}
