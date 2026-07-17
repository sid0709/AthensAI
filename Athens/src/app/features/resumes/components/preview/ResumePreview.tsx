import React, { useEffect, useMemo, useRef, useState } from "react";
import { Linkedin, Mail, MapPin, Phone } from "lucide-react";
import { cn } from "../../../../lib/utils";
import type {
  GeneratorIdentity,
  ResumeDocument,
  ResumeTheme,
  SectionId,
  SectionLayoutConfig,
} from "../../../../types/resume";
import { SECTION_LABEL } from "../../lib/generatorDefaults";
import { fontStack } from "../../lib/buildResumeModel";
import {
  SAMPLE_EDUCATION,
  SAMPLE_PREVIEW_CAREERS,
  SAMPLE_SKILL_GROUPS,
  SAMPLE_SUMMARY,
  type EducationEntry,
  type PreviewCareer,
} from "../../lib/previewSamples";
import { headingStyle, PAGE, pt, resolveHeadingColor, type PaperSize } from "../../lib/previewUtils";
import { templateById, type SectionType, type TemplateDef } from "../../lib/templates";
import { ExperienceEntry } from "./ExperienceEntry";

type ResumePreviewProps = {
  document: ResumeDocument;
  templateId: string;
  theme: ResumeTheme;
  sections: SectionLayoutConfig[];
  generatorIdentity?: GeneratorIdentity | null;
  generating?: boolean;
  generatedSections?: Partial<Record<SectionId, boolean>>;
  className?: string;
  fitToColumn?: boolean;
};

function docToSkillGroups(doc: ResumeDocument): { category: string; items: string[] }[] {
  const groups = [
    { category: "Programming Languages", items: doc.skills.languages },
    { category: "Frameworks", items: doc.skills.frameworks },
    { category: "Databases", items: doc.skills.databases },
    { category: "Cloud & DevOps", items: doc.skills.cloudDevOps },
  ].filter((g) => g.items.length);
  return groups.length ? groups : SAMPLE_SKILL_GROUPS;
}

function docToCareers(doc: ResumeDocument, identity?: GeneratorIdentity | null): PreviewCareer[] {
  if (doc.experiences.length) {
    return doc.experiences.map((e) => ({
      title: e.role,
      company: e.company,
      location: e.location,
      period: `${e.startDate} – ${e.endDate}`.replace(/^ – | – $/, "").trim() || e.startDate || e.endDate,
      bullets: e.bullets,
    }));
  }
  if (identity?.careers.length) {
    return identity.careers.map((c) => ({
      title: c.title,
      company: c.company,
      location: "",
      period: c.period,
      bullets: [],
    }));
  }
  return SAMPLE_PREVIEW_CAREERS;
}

function docToEducation(doc: ResumeDocument, identity?: GeneratorIdentity | null): EducationEntry[] {
  if (doc.education.length) {
    return doc.education.map((e) => ({
      school: e.school,
      degree: e.degree,
      period: e.graduationDate,
    }));
  }
  if (identity?.education.length) {
    return identity.education.map((e) => ({ school: e.school, degree: e.degree, period: e.period }));
  }
  return SAMPLE_EDUCATION;
}

function sectionLoading(
  type: SectionType,
  generating: boolean,
  generatedSections?: Partial<Record<SectionId, boolean>>,
  doc?: ResumeDocument,
): boolean {
  if (!generating) return false;
  if (generatedSections) {
    if (type === "summary") return !generatedSections.summary;
    if (type === "skills") return !generatedSections.skills;
    if (type === "experience") return !generatedSections.experience;
  }
  if (type === "summary") return !doc?.summary?.trim();
  if (type === "skills") {
    const s = doc?.skills;
    return !s || ![...s.languages, ...s.frameworks, ...s.databases, ...s.cloudDevOps].length;
  }
  if (type === "experience") return !doc?.experiences?.length;
  return false;
}

export function ResumePreview({
  document: doc,
  templateId,
  theme,
  sections,
  generatorIdentity,
  generating = false,
  generatedSections,
  className,
  fitToColumn = true,
}: ResumePreviewProps) {
  const fitRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const template = templateById(templateId);
  const paper = (theme.paperSize === "a4" ? "a4" : "letter") as PaperSize;
  const page = PAGE[paper];
  const marginIn = Number.isFinite(theme.marginIn) && theme.marginIn > 0 ? theme.marginIn : 0.6;
  const marginPx = Math.round(marginIn * 96);

  useEffect(() => {
    if (!fitToColumn) return;
    const el = fitRef.current;
    if (!el) return;
    const update = () => setScale(Math.min(1, el.clientWidth / page.w));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [page.w, fitToColumn]);

  const summaryText = doc.summary?.trim() || SAMPLE_SUMMARY;
  const skillGroups = useMemo(() => docToSkillGroups(doc), [doc]);
  const careers = useMemo(() => docToCareers(doc, generatorIdentity), [doc, generatorIdentity]);
  const education = useMemo(() => docToEducation(doc, generatorIdentity), [doc, generatorIdentity]);

  const sorted = [...sections].sort((a, b) => a.order - b.order);
  const layoutSections = sorted.map((s) => ({
    id: s.id,
    type: s.id as SectionType,
    titleSize: s.titleSizePt,
    bodySize: s.bodySizePt,
    titleColor: s.color,
  }));

  const sidebarSections = template.columns === 2 ? layoutSections.filter((s) => template.sidebar.includes(s.type)) : [];
  const mainSections = template.columns === 2 ? layoutSections.filter((s) => !template.sidebar.includes(s.type)) : layoutSections;

  const name = doc.identity.fullName || "Your Name";
  const contactItems = [
    { Icon: MapPin, text: doc.identity.location?.trim() },
    { Icon: Mail, text: doc.identity.email?.trim() },
    { Icon: Phone, text: doc.identity.phone?.trim() },
    { Icon: Linkedin, text: doc.identity.linkedin?.trim() },
  ].filter((c) => c.text);

  const nameColor = template.nameColor === "accent" ? theme.accentColor : theme.textColor;
  const contactSize = pt(Math.max(8, theme.bodySizePt - 1.5));
  const iconPx = Math.round(theme.bodySizePt * 1.25);

  const renderSectionBody = (section: (typeof layoutSections)[0], headingColor: string) => {
    const fs = pt(section.bodySize);
    const loading = sectionLoading(section.type, generating, generatedSections, doc);
    if (loading) {
      return <div style={{ height: 48, background: "#f3f4f6", borderRadius: 4, opacity: 0.7 }} />;
    }
    switch (section.type) {
      case "summary":
        return <p style={{ margin: 0, textAlign: "justify", fontSize: fs }}>{summaryText}</p>;
      case "skills":
        return (
          <div style={{ fontSize: fs }}>
            {skillGroups.map((g) => (
              <div key={g.category} style={{ marginBottom: 3 }}>
                <span style={{ fontWeight: 700, color: headingColor }}>{g.category}:</span> {g.items.join(", ")}
              </div>
            ))}
          </div>
        );
      case "experience":
        return (
          <div style={{ fontSize: fs }}>
            {careers.map((c, i) => (
              <div key={`${c.company}-${i}`} style={{ marginBottom: 10 }}>
                <ExperienceEntry career={c} layout={template.experienceLayout} bodySize={section.bodySize} accent={headingColor} />
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
  };

  const sectionBlock = (section: (typeof layoutSections)[0], key: string) => {
    const headingColor = resolveHeadingColor(template, section.titleColor, theme.textColor);
    const heading = (
      <div style={headingStyle(template, headingColor, section.titleSize)}>{SECTION_LABEL[section.type]}</div>
    );
    const body = renderSectionBody(section, headingColor);

    if (template.labelGutter) {
      return (
        <div key={key} style={{ display: "flex", gap: 24, marginBottom: 14 }}>
          <div style={{ width: "22%", flexShrink: 0 }}>{heading}</div>
          <div style={{ flex: 1, minWidth: 0 }}>{body}</div>
        </div>
      );
    }
    return (
      <div key={key} style={{ marginBottom: 14 }}>
        {heading}
        {body}
      </div>
    );
  };

  const nameEl = (
    <div
      style={{
        fontSize: pt(theme.nameSizePt),
        fontWeight: 700,
        letterSpacing: template.nameUppercase ? "0.04em" : "0.01em",
        color: nameColor,
        lineHeight: 1.1,
        textTransform: template.nameUppercase ? "uppercase" : "none",
      }}
    >
      {name}
    </div>
  );

  const contactEl = contactItems.length > 0 && (
    <div
      style={{
        fontSize: contactSize,
        color: theme.textColor,
        opacity: 0.85,
        display: "flex",
        flexWrap: "wrap",
        gap: template.contactIcons ? "4px 16px" : "0",
        justifyContent: template.labelGutter ? "flex-start" : theme.headerAlign === "center" ? "center" : "flex-start",
      }}
    >
      {template.contactIcons
        ? contactItems.map(({ Icon, text }) => (
            <span key={text} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <Icon style={{ width: iconPx, height: iconPx, opacity: 0.7 }} />
              {text}
            </span>
          ))
        : contactItems.map((c) => c.text).join("    ·    ")}
    </div>
  );

  const header = template.labelGutter ? (
    <div style={{ display: "flex", alignItems: "baseline", gap: 24, marginBottom: 18 }}>
      {nameEl}
      <div style={{ flex: 1, minWidth: 0 }}>{contactEl}</div>
    </div>
  ) : (
    <div style={{ textAlign: theme.headerAlign, marginBottom: 18 }}>
      {nameEl}
      {template.nameRule && <div style={{ borderBottom: `1px solid ${theme.accentColor}`, opacity: 0.5, margin: "8px 0" }} />}
      {contactItems.length > 0 && <div style={{ marginTop: template.nameRule ? 0 : 6 }}>{contactEl}</div>}
    </div>
  );

  const pageContent = (
    <div
      className={cn("resume-page bg-white shadow-2xl", className)}
      style={{
        position: "relative",
        overflow: "hidden",
        width: page.w,
        minHeight: page.h,
        boxSizing: "border-box",
        padding: marginPx,
        fontFamily: fontStack(theme.font),
        color: theme.textColor,
        fontSize: pt(theme.bodySizePt),
        lineHeight: 1.42,
        WebkitPrintColorAdjust: "exact",
        printColorAdjust: "exact",
      }}
    >
      {template.topBar && (
        <div style={{ height: 10, background: theme.accentColor, borderRadius: 2, marginBottom: 16 }} />
      )}
      {template.cornerAccent && (
        <div
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            width: "55%",
            height: 150,
            background: `${theme.accentColor}14`,
            clipPath: "polygon(100% 0, 100% 100%, 0 0)",
          }}
        />
      )}
      <div style={{ position: "relative" }}>{header}</div>
      <div style={{ position: "relative" }}>
        {template.columns === 2 ? (
          <div style={{ display: "flex", gap: 24, flexDirection: template.sidebarSide === "left" ? "row" : "row-reverse" }}>
            <div
              style={{
                width: `${template.sidebarWidthPct}%`,
                flexShrink: 0,
                ...(template.sidebarTint
                  ? { background: `${theme.accentColor}10`, padding: 14, borderRadius: 4 }
                  : {}),
              }}
            >
              {sidebarSections.map((s, i) => sectionBlock(s, `${s.type}-${i}`))}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              {mainSections.map((s, i) => sectionBlock(s, `${s.type}-${i}`))}
            </div>
          </div>
        ) : (
          mainSections.map((s, i) => sectionBlock(s, `${s.type}-${i}`))
        )}
      </div>
    </div>
  );

  if (!fitToColumn) {
    return (
      <div id="resume-print-root">
        {pageContent}
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-neutral-200/70 dark:bg-black/40 p-4 overflow-auto max-h-full w-full">
      <div ref={fitRef} className="w-full flex justify-center">
        <div className="resume-scale" style={{ "--resume-zoom": scale } as React.CSSProperties}>
          <div id="resume-print-root">{pageContent}</div>
        </div>
      </div>
    </div>
  );
}
