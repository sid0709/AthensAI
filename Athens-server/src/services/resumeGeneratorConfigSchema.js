import { defaultGeneratorConfig } from "../config/resumeGeneratorDefaults.js";

export const RESUME_GENERATOR_CONFIG_VERSION = 4;

const cleanString = (value) => String(value ?? "").trim();

const DEFAULT_COVERAGE_SETTINGS = Object.freeze({
  enabled: true,
  experienceRequirementThreshold: 4,
  aliases: {},
});

function normalizeAliases(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const aliases = {};
  for (const [rawName, rawValues] of Object.entries(value)) {
    const name = cleanString(rawName);
    if (!name || !Array.isArray(rawValues)) continue;
    const values = [...new Set(rawValues.map(cleanString).filter(Boolean))].slice(0, 20);
    if (values.length) aliases[name] = values;
  }
  return aliases;
}

export function normalizeCoverageSettings(value) {
  const raw = value && typeof value === "object" ? value : {};
  return {
    enabled: true,
    experienceRequirementThreshold: 4,
    aliases: normalizeAliases(raw.aliases),
  };
}

function legacyTheme(theme, base) {
  if (!theme || typeof theme !== "object") return base;
  return {
    ...base,
    font: cleanString(theme.font) || base.font,
    baseSize: Number(theme.baseSize ?? theme.bodySizePt) || base.baseSize,
    nameSize: Number(theme.nameSize ?? theme.nameSizePt) || base.nameSize,
    titleSize: Number(theme.titleSize) || base.titleSize,
    accent: cleanString(theme.accent ?? theme.accentColor) || base.accent,
    text: cleanString(theme.text ?? theme.textColor) || base.text,
    headerAlign: theme.headerAlign === "left" ? "left" : base.headerAlign,
    paper: theme.paper === "a4" || theme.paperSize === "a4" ? "a4" : base.paper,
    margin: Number(theme.margin ?? theme.marginIn) || base.margin,
  };
}

function legacyLayout(saved, theme, base) {
  if (Array.isArray(saved.layout) && saved.layout.length) return saved.layout;
  if (!Array.isArray(saved.sections) || !saved.sections.length) return base;
  const titleByType = {
    summary: "Professional Summary",
    skills: "Skills",
    experience: "Experience",
    education: "Education",
  };
  return [...saved.sections]
    .sort((left, right) => Number(left?.order ?? 0) - Number(right?.order ?? 0))
    .map((section, index) => {
      const type = cleanString(section?.type ?? section?.id);
      if (!Object.hasOwn(titleByType, type)) return null;
      return {
        id: cleanString(section?.id) || `${type}-${index}`,
        type,
        title: cleanString(section?.title) || titleByType[type],
        titleColor: cleanString(section?.titleColor ?? section?.color) || theme.accent,
        titleSize: Number(section?.titleSize ?? section?.titleSizePt) || theme.titleSize,
        bodySize: Number(section?.bodySize ?? section?.bodySizePt) || theme.baseSize,
      };
    })
    .filter(Boolean);
}

function stepList(saved, base) {
  const source = Array.isArray(saved.steps) && saved.steps.length
    ? saved.steps
    : Array.isArray(saved.refinementSteps) && saved.refinementSteps.length
      ? saved.refinementSteps
      : base;
  return source.map((step, index) => {
    return {
      ...step,
      id: cleanString(step?.id) || `migrated-step-${index + 1}`,
      name: cleanString(step?.name) || `Step ${index + 1}`,
      prompt: String(step?.prompt ?? ""),
      schema: typeof step?.schema === "string"
        ? step.schema
        : step?.schema && typeof step.schema === "object"
          ? JSON.stringify(step.schema, null, 2)
          : "",
    };
  });
}

/**
 * Convert every historical Resume Generator shape into the one canonical v4
 * persistence shape. Job descriptions and generated documents intentionally do
 * not belong here; they are ApplicationRun data.
 */
export function migrateGeneratorConfig(saved) {
  const raw = saved && typeof saved === "object" ? saved : {};
  const flattened = raw.settings || raw.presentation
    ? { ...(raw.settings || {}), ...(raw.presentation || {}), schemaVersion: raw.schemaVersion }
    : raw;
  const base = defaultGeneratorConfig();
  const theme = legacyTheme(flattened.theme, base.theme);
  const config = {
    schemaVersion: RESUME_GENERATOR_CONFIG_VERSION,
    provider: flattened.provider === "deepseek" ? "deepseek" : "openai",
    model: cleanString(flattened.model) || base.model,
    reasoningEffort: cleanString(flattened.reasoningEffort) || base.reasoningEffort,
    dynamicCareerTitles: flattened.dynamicCareerTitles === true,
    templateId: cleanString(flattened.templateId) || base.templateId,
    ...(flattened.uploadedTemplate && typeof flattened.uploadedTemplate === "object"
      ? { uploadedTemplate: flattened.uploadedTemplate }
      : {}),
    theme,
    layout: legacyLayout(flattened, theme, base.layout),
    systemInstruction: typeof flattened.systemInstruction === "string"
      ? flattened.systemInstruction
      : base.systemInstruction,
    steps: stepList(flattened, base.steps),
    coverage: normalizeCoverageSettings(flattened.coverage),
  };
  const sourceVersion = Number(raw.schemaVersion) || (raw.refinementSteps || raw.document ? 2 : 1);
  const canonicalInput = sourceVersion === RESUME_GENERATOR_CONFIG_VERSION
    && !Object.hasOwn(raw, "jobDescription")
    && !Object.hasOwn(raw, "document")
    && !Object.hasOwn(raw, "refinementSteps")
    && !raw.settings
    && !raw.presentation;
  return {
    config,
    migrated: !canonicalInput || JSON.stringify(raw) !== JSON.stringify(config),
    sourceVersion,
    legacyJobDescription: cleanString(raw.jobDescription) || null,
  };
}

export function isCanonicalGeneratorConfig(value) {
  return migrateGeneratorConfig(value).migrated === false;
}

export { DEFAULT_COVERAGE_SETTINGS };
