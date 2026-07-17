import type { EducationEntry, LayoutSection, PreviewCareer, PreviewEdit, TemplateDef } from "../types";
import { SECTION_LABEL } from "../types";
import { SectionBody } from "./section-body";
import { headingStyle, resolveHeadingColor } from "./utils";

export function SectionBlock({
  section,
  template,
  headingColor,
  loading,
  editable,
  onEdit,
  summaryText,
  skillGroups,
  careers,
  education,
  onTitleChange,
}: {
  section: LayoutSection;
  template: TemplateDef;
  headingColor: string;
  loading: boolean;
  editable: boolean;
  onEdit?: (e: PreviewEdit) => void;
  summaryText: string;
  skillGroups: { category: string; items: string[] }[];
  careers: PreviewCareer[];
  education: EducationEntry[];
  onTitleChange: (id: string, title: string) => void;
}) {
  // Section headings are fixed per type (SUMMARY / EXPERIENCE / SKILLS /
  // EDUCATION) — not editable — so they can never drift or duplicate.
  const heading = (
    <div style={headingStyle(template, headingColor, section.titleSize)}>{SECTION_LABEL[section.type]}</div>
  );
  const body = (
    <SectionBody
      headingColor={headingColor}
      loading={loading}
      editable={editable}
      onEdit={onEdit}
      section={section}
      template={template}
      summaryText={summaryText}
      skillGroups={skillGroups}
      careers={careers}
      education={education}
    />
  );

  // Dev layout: section label sits in a left gutter, body on the right.
  // Note: we deliberately do NOT set break-inside:avoid on the whole section — a
  // long section (e.g. Experience) must be allowed to flow across pages. Page
  // breaks are kept clean at the entry level instead (each ExperienceEntry /
  // education row sets break-inside:avoid), and headings avoid being orphaned.
  if (template.labelGutter) {
    return (
      <div style={{ display: "flex", gap: 24, marginBottom: 14 }}>
        <div style={{ width: "22%", flexShrink: 0 }}>{heading}</div>
        <div style={{ flex: 1, minWidth: 0 }}>{body}</div>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 14 }}>
      {heading}
      {body}
    </div>
  );
}
