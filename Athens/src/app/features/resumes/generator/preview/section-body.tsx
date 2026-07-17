import type { EducationEntry, LayoutSection, PreviewCareer, PreviewEdit, TemplateDef } from "../types";
import { EditableRich, renderRich } from "./rich-text";
import { ExperienceEntry } from "./experience-entry";
import { SectionSkeleton } from "./section-skeleton";
import { pt } from "./utils";

export function SectionBody({
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
}) {
  const fs = pt(section.bodySize);
  if (loading) return <SectionSkeleton type={section.type} />;
  switch (section.type) {
    case "summary":
      return editable ? (
        <EditableRich as="p" value={summaryText} onChange={(t) => onEdit?.({ kind: "summary", text: t })} style={{ margin: 0, textAlign: "justify", fontSize: fs }} />
      ) : (
        <p style={{ margin: 0, textAlign: "justify", fontSize: fs }}>{renderRich(summaryText)}</p>
      );
    case "skills":
      // Categorized, no bullets: "Programming Languages: TypeScript, JavaScript…"
      // Block layout (not flexbox) + margins so it paginates cleanly in print.
      return (
        <div style={{ fontSize: fs }}>
          {skillGroups.map((g) => (
            <div key={g.category} style={{ marginBottom: 3 }}>
              <span style={{ fontWeight: 700, color: headingColor }}>{renderRich(g.category)}:</span>{" "}
              {renderRich(g.items.join(", "))}
            </div>
          ))}
        </div>
      );
    case "experience":
      // Block layout (NOT flexbox): a flex column won't break across pages, which
      // forced each role onto a fresh page and left large gaps. Plain block flow
      // lets long roles span a page boundary; each bullet stays whole on its own.
      return (
        <div style={{ fontSize: fs }}>
          {careers.map((c, i) => (
            <div key={`${c.company}-${i}`} style={{ marginBottom: 10 }}>
              <ExperienceEntry c={c} layout={template.experienceLayout} section={section} accent={headingColor} editable={editable} expIndex={i} onEdit={onEdit} />
            </div>
          ))}
        </div>
      );
    case "education":
      return (
        <div style={{ fontSize: fs }}>
          {education.map((e, i) => (
            <div key={`${e.school}-${i}`} style={{ breakInside: "avoid", marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
                <span style={{ fontWeight: 700 }}>{e.school || "School"}</span>
                <span style={{ opacity: 0.7, whiteSpace: "nowrap", fontSize: pt(Math.max(8, section.bodySize - 1)) }}>{e.period}</span>
              </div>
              {e.degree && <div style={{ fontStyle: "italic", color: headingColor }}>{e.degree}</div>}
            </div>
          ))}
        </div>
      );
  }
}
