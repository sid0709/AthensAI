import type { TemplateDef } from "./templates";

export function pt(n: number) {
  return `${n}pt`;
}

export type PaperSize = "letter" | "a4";

export const PAGE: Record<PaperSize, { w: number; h: number; css: string; label: string }> = {
  letter: { w: 816, h: 1056, css: "letter", label: 'Letter · 8.5" × 11"' },
  a4: { w: 794, h: 1123, css: "A4", label: "A4 · 210 × 297 mm" },
};

const MUTED_HEADING = "#6b7280";

export function resolveHeadingColor(template: TemplateDef, sectionColor: string, textColor: string): string {
  if (template.headingMuted) return MUTED_HEADING;
  if (template.headingColor === "text") return textColor;
  return sectionColor;
}

export function headingStyle(template: TemplateDef, color: string, size: number): React.CSSProperties {
  const titleCase = template.headingCase === "title";
  const base: React.CSSProperties = {
    fontSize: pt(size),
    fontWeight: 700,
    color,
    textTransform: titleCase ? "none" : "uppercase",
    letterSpacing: titleCase ? "0" : "0.08em",
    marginBottom: 7,
    textAlign: template.headingAlign,
    breakAfter: "avoid",
  };
  if (template.heading === "underline") return { ...base, borderBottom: `1.5px solid ${color}`, paddingBottom: 3 };
  if (template.heading === "bar") return { ...base, borderLeft: `3px solid ${color}`, paddingLeft: 8 };
  if (template.heading === "centered-rules") {
    return { ...base, textAlign: "center", borderTop: `1px solid ${color}`, borderBottom: `1px solid ${color}`, paddingTop: 3, paddingBottom: 3 };
  }
  return { ...base, paddingBottom: 1 };
}

export function printCss(paper: PaperSize): string {
  return `
.resume-scale { zoom: var(--resume-zoom, 1); }
@media print {
  body { background: #fff !important; }
  body * { visibility: hidden !important; }
  #resume-print-root, #resume-print-root * { visibility: visible !important; }
  #resume-print-root { position: absolute; left: 0; top: 0; margin: 0; }
  .resume-scale { zoom: 1 !important; }
  #resume-print-root .resume-page { box-shadow: none !important; border-radius: 0 !important; }
  @page { size: ${PAGE[paper].css}; margin: 0; }
}`;
}
