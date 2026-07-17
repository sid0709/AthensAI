import { templateById } from "./constants/templates";
import { SAMPLE_BULLETS, SAMPLE_EDUCATION, SAMPLE_PREVIEW_CAREERS, SAMPLE_SKILL_GROUPS, SAMPLE_SUMMARY } from "./constants/samples";
import { SECTION_LABEL, type GeneratedContent, type GeneratorConfig, type Identity, type PreviewCareer } from "./types";
import { resolveHeadingColor } from "./preview/utils";

export function buildResumeModel(config: GeneratorConfig, generated: GeneratedContent | null, identity: Identity | null) {
  const { theme } = config;
  const template = templateById(config.templateId);
  const summaryText = generated?.summary ?? SAMPLE_SUMMARY;
  const skillGroups = generated?.skills && generated.skills.length ? generated.skills : SAMPLE_SKILL_GROUPS;
  const careers: PreviewCareer[] =
    generated?.experience && generated.experience.length
      ? generated.experience
      : identity && identity.careers.length
        ? identity.careers.map((c) => ({ title: c.title, company: c.company, location: "", period: c.period, bullets: SAMPLE_BULLETS }))
        : SAMPLE_PREVIEW_CAREERS;
  const education = identity && identity.education.length ? identity.education : SAMPLE_EDUCATION;

  const sections = config.layout.map((s) => {
    const base = {
      type: s.type,
      title: SECTION_LABEL[s.type],
      titleSizePt: s.titleSize,
      bodySizePt: s.bodySize,
      headingColor: resolveHeadingColor(template, s.titleColor, theme.text),
      headingStyle: template.heading,
    };
    if (s.type === "summary") return { ...base, summary: summaryText };
    if (s.type === "skills") return { ...base, skills: skillGroups };
    if (s.type === "experience")
      return { ...base, experience: careers.map((c) => ({ title: c.title, company: c.company, period: c.period, bullets: c.bullets })) };
    return { ...base, education };
  });

  return {
    name: identity?.fullName || "Your Name",
    contact: [identity?.location, identity?.email, identity?.phone, identity?.linkedin].map((x) => (x ?? "").trim()).filter(Boolean),
    headerAlign: theme.headerAlign,
    headingAlign: template.headingAlign,
    nameSizePt: theme.nameSize,
    nameColor: template.nameColor === "accent" ? theme.accent : theme.text,
    baseSizePt: theme.baseSize,
    textColor: theme.text,
    accentColor: theme.accent,
    sections,
  };
}
