import type { TemplateDef } from "../types";

export const MONO_FONT = 'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

export const TEMPLATES: TemplateDef[] = [
  // ---- Original generic templates ----------------------------------------
  {
    id: "classic", name: "Classic", blurb: "Single column · centered header · underlined headings",
    columns: 1, sidebar: [], sidebarSide: "left", sidebarWidthPct: 34, sidebarTint: false,
    heading: "underline", headingAlign: "left", defaultHeaderAlign: "center",
    experienceLayout: "default", contactIcons: false, nameColor: "accent",
  },
  {
    id: "centered", name: "Centered", blurb: "Single column · centered header & section headings",
    columns: 1, sidebar: [], sidebarSide: "left", sidebarWidthPct: 34, sidebarTint: false,
    heading: "underline", headingAlign: "center", defaultHeaderAlign: "center",
    experienceLayout: "default", contactIcons: false, nameColor: "accent",
  },
  {
    id: "minimal", name: "Minimal", blurb: "Single column · left header · clean headings",
    columns: 1, sidebar: [], sidebarSide: "left", sidebarWidthPct: 34, sidebarTint: false,
    heading: "plain", headingAlign: "left", defaultHeaderAlign: "left",
    experienceLayout: "default", contactIcons: false, nameColor: "accent",
  },
  {
    id: "accent-bar", name: "Accent Bar", blurb: "Single column · left header · accent-bar headings",
    columns: 1, sidebar: [], sidebarSide: "left", sidebarWidthPct: 34, sidebarTint: false,
    heading: "bar", headingAlign: "left", defaultHeaderAlign: "left",
    experienceLayout: "default", contactIcons: false, nameColor: "accent",
  },
  {
    id: "sidebar", name: "Two-Column", blurb: "Sidebar (skills + education) · main (summary + experience)",
    columns: 2, sidebar: ["skills", "education"], sidebarSide: "left", sidebarWidthPct: 34, sidebarTint: true,
    heading: "underline", headingAlign: "left", defaultHeaderAlign: "center",
    experienceLayout: "default", contactIcons: false, nameColor: "accent",
  },
  // ---- Industry-standard named formats -----------------------------------
  {
    id: "standard", name: "Standard", blurb: "Reverse-chronological · the safe ATS default · icons in header",
    columns: 1, sidebar: [], sidebarSide: "left", sidebarWidthPct: 34, sidebarTint: false,
    heading: "underline", headingAlign: "left", defaultHeaderAlign: "center",
    experienceLayout: "standard", contactIcons: true, nameColor: "accent",
    defaults: { font: "Times New Roman", accent: "#1f3a5f" },
  },
  {
    id: "compact", name: "Compact", blurb: "High-density · single-line roles · fits long histories",
    columns: 1, sidebar: [], sidebarSide: "left", sidebarWidthPct: 34, sidebarTint: false,
    heading: "underline", headingAlign: "left", defaultHeaderAlign: "center",
    experienceLayout: "single-line", contactIcons: true, nameColor: "accent",
    defaults: { font: "Times New Roman", accent: "#1f3a5f" },
  },
  {
    id: "modern", name: "Modern", blurb: "Sans-serif · blue accent · clean tech look",
    columns: 1, sidebar: [], sidebarSide: "left", sidebarWidthPct: 34, sidebarTint: false,
    heading: "plain", headingAlign: "left", defaultHeaderAlign: "left",
    experienceLayout: "modern", contactIcons: true, nameColor: "accent",
    defaults: { font: "Inter", accent: "#2563eb" },
  },
  {
    id: "harvard", name: "Harvard", blurb: "Centered headings with rules · company-first · academic",
    columns: 1, sidebar: [], sidebarSide: "left", sidebarWidthPct: 34, sidebarTint: false,
    heading: "centered-rules", headingAlign: "center", defaultHeaderAlign: "center",
    experienceLayout: "harvard", contactIcons: false, nameColor: "text",
    defaults: { font: "Times New Roman", accent: "#1f2937" },
  },
  {
    id: "jakes", name: "Jake's", blurb: "LaTeX-style dense single column · company-first · italic roles",
    columns: 1, sidebar: [], sidebarSide: "left", sidebarWidthPct: 34, sidebarTint: false,
    heading: "underline", headingAlign: "left", defaultHeaderAlign: "center",
    experienceLayout: "jakes", contactIcons: false, nameColor: "text",
    defaults: { font: "Georgia", accent: "#1a1a1a" },
  },
  // ---- Creative / developer formats --------------------------------------
  {
    id: "bold", name: "Bold", blurb: "Top accent bar · name rule · title-case headings · single-line roles",
    columns: 1, sidebar: [], sidebarSide: "left", sidebarWidthPct: 34, sidebarTint: false,
    heading: "plain", headingAlign: "left", defaultHeaderAlign: "left",
    experienceLayout: "single-line", contactIcons: true, nameColor: "text",
    headingCase: "title", nameRule: true, topBar: true, headingColor: "text",
    defaults: { font: "Inter", accent: "#2f6df6" },
  },
  {
    id: "alternative", name: "Alternative", blurb: "Per-entry two columns · uppercase name · corner accent",
    columns: 1, sidebar: [], sidebarSide: "left", sidebarWidthPct: 34, sidebarTint: false,
    heading: "plain", headingAlign: "left", defaultHeaderAlign: "left",
    experienceLayout: "two-col-entry", contactIcons: true, nameColor: "text",
    headingMuted: true, nameUppercase: true, cornerAccent: true,
    defaults: { font: "Inter", accent: "#2563eb" },
  },
  {
    id: "dev-compact", name: "Dev Compact", blurb: "Monospace · company-first · dividers · dense",
    columns: 1, sidebar: [], sidebarSide: "left", sidebarWidthPct: 34, sidebarTint: false,
    heading: "plain", headingAlign: "left", defaultHeaderAlign: "left",
    experienceLayout: "dev", contactIcons: false, nameColor: "text",
    headingCase: "title", headingMuted: true,
    defaults: { font: MONO_FONT, accent: "#111827" },
  },
  {
    id: "dev", name: "Dev", blurb: "Monospace · section labels in a left gutter",
    columns: 1, sidebar: [], sidebarSide: "left", sidebarWidthPct: 34, sidebarTint: false,
    heading: "plain", headingAlign: "left", defaultHeaderAlign: "left",
    experienceLayout: "dev", contactIcons: false, nameColor: "text",
    headingCase: "title", headingMuted: true, labelGutter: true,
    defaults: { font: MONO_FONT, accent: "#111827" },
  },
];

export const templateById = (id: string): TemplateDef => TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];
