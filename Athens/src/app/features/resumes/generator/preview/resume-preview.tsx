import { useEffect, useRef, useState } from "react";
import { Linkedin, Mail, MapPin, Phone } from "lucide-react";
import {
  SAMPLE_BULLETS,
  SAMPLE_EDUCATION,
  SAMPLE_PREVIEW_CAREERS,
  SAMPLE_SKILL_GROUPS,
  SAMPLE_SUMMARY,
} from "../constants/samples";
import { fontStack } from "../constants/defaults";
import type {
  GeneratedContent,
  Identity,
  LayoutSection,
  PreviewCareer,
  PreviewEdit,
  ResumeTheme,
  SectionType,
  TemplateDef,
} from "../types";
import { SectionBlock } from "./section-block";
import { PAGE, pt, resolveHeadingColor } from "./utils";

export function ResumePreview({
  template,
  theme,
  layout,
  identity,
  generated,
  generating = false,
  onEdit,
  onTitleChange,
}: {
  template: TemplateDef;
  theme: ResumeTheme;
  layout: LayoutSection[];
  identity: Identity | null;
  generated: GeneratedContent | null;
  generating?: boolean;
  onEdit?: (e: PreviewEdit) => void;
  onTitleChange: (id: string, title: string) => void;
}) {
  const fitRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const page = PAGE[theme.paper];

  // Scale the true-size page down to fit the available column width.
  useEffect(() => {
    const el = fitRef.current;
    if (!el) return;
    const update = () => setScale(Math.min(1, el.clientWidth / page.w));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [page.w]);

  const name = identity?.fullName || "Your Name";
  const contactItems = [
    { Icon: MapPin, text: (identity?.location ?? "").trim() },
    { Icon: Mail, text: (identity?.email ?? "").trim() },
    { Icon: Phone, text: (identity?.phone ?? "").trim() },
    { Icon: Linkedin, text: (identity?.linkedin ?? "").trim() },
  ].filter((c) => c.text);
  // Prefer AI-generated content once a run completes; otherwise show sample text
  // (Experience falls back to the real profile careers, Education always uses the
  // profile since it isn't AI-generated).
  const summaryText = generated?.summary ?? SAMPLE_SUMMARY;
  const skillGroups = generated?.skills && generated.skills.length ? generated.skills : SAMPLE_SKILL_GROUPS;
  const careers: PreviewCareer[] =
    generated?.experience && generated.experience.length
      ? generated.experience
      : identity && identity.careers.length
        ? identity.careers.map((c) => ({ title: c.title, company: c.company, location: "", period: c.period, bullets: SAMPLE_BULLETS }))
        : SAMPLE_PREVIEW_CAREERS;
  const education = identity && identity.education.length ? identity.education : SAMPLE_EDUCATION;
  const marginPx = Math.round(theme.margin * 96);
  const nameColor = template.nameColor === "accent" ? theme.accent : theme.text;
  const contactSize = pt(Math.max(8, theme.baseSize - 1.5));
  const iconPx = Math.round(theme.baseSize * 1.25);

  // A content section shows a skeleton while generating until its own final step
  // has landed. Education is profile-sourced, so it never waits.
  const sectionLoading = (t: SectionType): boolean => {
    if (!generating) return false;
    if (t === "summary") return !generated?.summary;
    if (t === "skills") return !generated?.skills;
    if (t === "experience") return !generated?.experience;
    return false;
  };

  // Content is editable only once real AI content exists and an edit handler is
  // wired (the editor view); History/read-only renders pass no onEdit.
  const editable = Boolean(onEdit) && Boolean(generated) && !generating;

  const sectionBlock = (section: LayoutSection, key: string) => (
    <SectionBlock
      key={key}
      section={section}
      template={template}
      headingColor={resolveHeadingColor(template, section.titleColor, theme.text)}
      loading={sectionLoading(section.type)}
      editable={editable}
      onEdit={onEdit}
      summaryText={summaryText}
      skillGroups={skillGroups}
      careers={careers}
      education={education}
      onTitleChange={onTitleChange}
    />
  );

  // Two-column: split by template.sidebar membership; one-column: layout order.
  const sidebarSections = template.columns === 2 ? layout.filter((s) => template.sidebar.includes(s.type)) : [];
  const mainSections = template.columns === 2 ? layout.filter((s) => !template.sidebar.includes(s.type)) : layout;
  const sectionKey = (section: LayoutSection, index: number) => section.id ?? `${section.type}-${index}`;

  const nameEl = (
    <div
      style={{
        fontSize: pt(theme.nameSize),
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
        color: theme.text,
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

  // Dev (labelGutter): name on the left, contact inline on the right. Otherwise
  // the classic stacked header, with an optional rule under the name.
  const header = template.labelGutter ? (
    <div style={{ display: "flex", alignItems: "baseline", gap: 24, marginBottom: 18 }}>
      {nameEl}
      <div style={{ flex: 1, minWidth: 0 }}>{contactEl}</div>
    </div>
  ) : (
    <div style={{ textAlign: theme.headerAlign, marginBottom: 18 }}>
      {nameEl}
      {template.nameRule && <div style={{ borderBottom: `1px solid ${theme.accent}`, opacity: 0.5, margin: "8px 0" }} />}
      {contactItems.length > 0 && <div style={{ marginTop: template.nameRule ? 0 : 6 }}>{contactEl}</div>}
    </div>
  );

  return (
    <div className="rounded-xl bg-neutral-200/70 dark:bg-black/40 p-4 overflow-auto max-h-[820px]">
      <div ref={fitRef} className="w-full flex justify-center">
        <div className="resume-scale" style={{ "--resume-zoom": scale } as React.CSSProperties}>
          <div id="resume-print-root">
            <div
              className="resume-page bg-white shadow-2xl"
              style={{
                position: "relative",
                overflow: "hidden",
                width: page.w,
                minHeight: page.h,
                boxSizing: "border-box",
                padding: marginPx,
                fontFamily: fontStack(theme.font),
                color: theme.text,
                fontSize: pt(theme.baseSize),
                lineHeight: 1.42,
                WebkitPrintColorAdjust: "exact",
                printColorAdjust: "exact",
              }}
            >
              {/* Bold: accent band across the top. A normal-flow element (not
                  absolute) so the header always sits below it — the PDF export
                  ships the page's inner HTML without the padding, and an absolute
                  bar would overlap the name there. */}
              {template.topBar && (
                <div style={{ height: 10, background: theme.accent, borderRadius: 2, marginBottom: 16 }} />
              )}
              {/* Alternative: decorative tinted shape in the top-right corner. */}
              {template.cornerAccent && (
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    right: 0,
                    width: "55%",
                    height: 150,
                    background: `${theme.accent}14`,
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
                          ? { background: `${theme.accent}10`, padding: 14, borderRadius: 4, marginLeft: template.sidebarSide === "left" ? -6 : 0 }
                          : {}),
                      }}
                    >
                      {sidebarSections.map((section, i) => sectionBlock(section, sectionKey(section, i)))}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {mainSections.map((section, i) => sectionBlock(section, sectionKey(section, i)))}
                    </div>
                  </div>
                ) : (
                  mainSections.map((section, i) => sectionBlock(section, sectionKey(section, i)))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
