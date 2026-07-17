import type { PaperSize, TemplateDef } from "../types";

export function pt(n: number) {
  return `${n}pt`;
}

// Paper dimensions in CSS px at 96dpi (1in = 96px). The page element is rendered
// at exactly these dimensions so the on-screen preview and the print/PDF output
// are pixel-identical — only an on-screen `zoom` scales it to fit the column.
export const PAGE: Record<PaperSize, { w: number; h: number; css: string; label: string }> = {
  letter: { w: 816, h: 1056, css: "letter", label: 'Letter · 8.5" × 11"' },
  a4: { w: 794, h: 1123, css: "A4", label: "A4 · 210 × 297 mm" },
};

// Print stylesheet: isolate the resume page (#resume-print-root), reset the
// on-screen zoom, and set the page size so "Save as PDF" matches the preview.
export function printCss(paper: PaperSize): string {
  return `
.resume-scale { zoom: var(--resume-zoom, 1); }
@media print {
  body { background: #fff !important; }
  body * { visibility: hidden !important; }
  #resume-print-root, #resume-print-root * { visibility: visible !important; }
  #resume-print-root { position: absolute; left: 0; top: 0; margin: 0; }
  /* Reset the on-screen fit-to-column zoom (the .resume-scale wrapper is an
     ANCESTOR of the print root) so the page prints at true paper size. */
  .resume-scale { zoom: 1 !important; }
  #resume-print-root .resume-page { box-shadow: none !important; border-radius: 0 !important; }
  @page { size: ${PAGE[paper].css}; margin: 0; }
}`;
}

const MUTED_HEADING = "#6b7280";

// Resolve the accent color for headings + skill categories + experience accents:
// muted gray (Dev), the dark body color ("text" mode, e.g. Bold), or the
// section's own title color (default).
export function resolveHeadingColor(template: TemplateDef, sectionColor: string, textColor: string): string {
  if (template.headingMuted) return MUTED_HEADING;
  if (template.headingColor === "text") return textColor;
  return sectionColor;
}

export function headingStyle(template: TemplateDef, color: string, size: number): React.CSSProperties {
  const c = color; // already resolved by the caller
  const titleCase = template.headingCase === "title";
  const base: React.CSSProperties = {
    fontSize: pt(size),
    fontWeight: 700,
    color: c,
    textTransform: titleCase ? "none" : "uppercase",
    letterSpacing: titleCase ? "0" : "0.08em",
    marginBottom: 7,
    outline: "none",
    textAlign: template.headingAlign,
    // Keep a section heading attached to the content that follows it.
    breakAfter: "avoid",
  };
  if (template.heading === "underline") return { ...base, borderBottom: `1.5px solid ${c}`, paddingBottom: 3 };
  if (template.heading === "bar") return { ...base, borderLeft: `3px solid ${c}`, paddingLeft: 8 };
  // Harvard: a thin rule above and below a centered heading.
  if (template.heading === "centered-rules")
    return { ...base, textAlign: "center", borderTop: `1px solid ${c}`, borderBottom: `1px solid ${c}`, paddingTop: 3, paddingBottom: 3 };
  return { ...base, paddingBottom: 1 };
}
