import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Tab,
  TabStopType,
  AlignmentType,
  BorderStyle,
} from "docx";

/**
 * Server-side resume DOCX rendering — built with the `docx` library from a
 * structured resume model the frontend sends (NOT raw HTML). html-to-docx
 * produced files Word refused to open; `docx` emits spec-compliant OOXML Word
 * trusts, and lets us right-align dates with real tab stops.
 */

const PT = (pt, fallback) => {
  const n = Number(pt);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 2) : fallback; // docx sizes are half-points
};
const hex = (c) => String(c || "").replace(/^#/, "").trim() || undefined;
const TWIPS_PER_IN = 1440;
const PAGE_IN = { letter: { w: 8.5, h: 11 }, a4: { w: 8.27, h: 11.69 } };

// Split "**bold** text" into docx TextRuns, carrying base run options.
function runs(text, base) {
  const out = [];
  const parts = String(text ?? "").split(/(\*\*[^*]+?\*\*)/g);
  for (const p of parts) {
    if (!p) continue;
    const bold = /^\*\*[^*]+?\*\*$/.test(p);
    out.push(new TextRun({ ...base, text: bold ? p.slice(2, -2) : p, bold: bold || base.bold }));
  }
  return out.length ? out : [new TextRun({ ...base, text: "" })];
}

export async function renderResumeDocx(req, res) {
  try {
    const body = req.body || {};
    const model = body.model && typeof body.model === "object" ? body.model : null;
    if (!model) return res.status(400).json({ success: false, error: "model is required" });

    const paper = body.paper === "a4" ? "a4" : "letter";
    const marginRaw = Number(body.marginInches);
    const marginIn = Number.isFinite(marginRaw) && marginRaw >= 0 ? marginRaw : 0.6;
    const marginTwips = Math.round(marginIn * TWIPS_PER_IN);
    const font = body.font ? String(body.font).split(",")[0].replace(/['"]/g, "").trim() || "Calibri" : "Calibri";

    const baseSize = PT(model.baseSizePt, 21);
    const textColor = hex(model.textColor) || "1a1a1a";
    const accent = hex(model.accentColor) || "1f3a5f";
    const headerAlign = model.headerAlign === "left" ? AlignmentType.LEFT : AlignmentType.CENTER;
    // Right tab stop = content width (page width minus both margins).
    const rightTab = Math.round((PAGE_IN[paper].w - marginIn * 2) * TWIPS_PER_IN);

    const baseRun = { font, size: baseSize, color: textColor };
    const children = [];

    // Header — name + contact.
    children.push(
      new Paragraph({
        alignment: headerAlign,
        spacing: { after: 60 },
        children: [new TextRun({ text: String(model.name || "Your Name"), bold: true, font, size: PT(model.nameSizePt, 48), color: hex(model.nameColor) || textColor })],
      }),
    );
    if (Array.isArray(model.contact) && model.contact.length) {
      children.push(
        new Paragraph({
          alignment: headerAlign,
          spacing: { after: 200 },
          children: [new TextRun({ text: model.contact.filter(Boolean).join("    ·    "), font, size: Math.max(16, baseSize - 3), color: textColor })],
        }),
      );
    }

    const headingAlign = model.headingAlign === "center" ? AlignmentType.CENTER : AlignmentType.LEFT;

    for (const section of Array.isArray(model.sections) ? model.sections : []) {
      const headingColor = hex(section.headingColor) || accent;
      const titleSize = PT(section.titleSizePt, 24);
      const bodySize = PT(section.bodySizePt, baseSize);
      const title = String(section.title || "").toUpperCase();

      children.push(
        new Paragraph({
          alignment: headingAlign,
          spacing: { before: 160, after: 80 },
          border:
            section.headingStyle === "underline"
              ? { bottom: { style: BorderStyle.SINGLE, size: 6, color: headingColor, space: 2 } }
              : undefined,
          children: [new TextRun({ text: title, bold: true, font, size: titleSize, color: headingColor, characterSpacing: 14 })],
        }),
      );

      const bodyRun = { font, size: bodySize, color: textColor };

      if (section.type === "summary") {
        children.push(new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: { after: 120 }, children: runs(section.summary, bodyRun) }));
      } else if (section.type === "skills") {
        for (const g of Array.isArray(section.skills) ? section.skills : []) {
          children.push(
            new Paragraph({
              spacing: { after: 40 },
              children: [
                new TextRun({ ...bodyRun, text: `${g.category}: `, bold: true, color: headingColor }),
                new TextRun({ ...bodyRun, text: (Array.isArray(g.items) ? g.items : []).join(", ") }),
              ],
            }),
          );
        }
      } else if (section.type === "experience") {
        for (const e of Array.isArray(section.experience) ? section.experience : []) {
          children.push(
            new Paragraph({
              tabStops: [{ type: TabStopType.RIGHT, position: rightTab }],
              spacing: { before: 120 },
              children: [
                new TextRun({ ...bodyRun, text: String(e.title || ""), bold: true }),
                new TextRun({ ...bodyRun, children: [new Tab(), String(e.period || "")], color: "6b7280" }),
              ],
            }),
          );
          if (e.company) {
            children.push(new Paragraph({ spacing: { after: 20 }, children: [new TextRun({ ...bodyRun, text: String(e.company), italics: true, color: headingColor })] }));
          }
          for (const b of Array.isArray(e.bullets) ? e.bullets : []) {
            children.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 10 }, children: runs(b, bodyRun) }));
          }
        }
      } else if (section.type === "education") {
        for (const ed of Array.isArray(section.education) ? section.education : []) {
          children.push(
            new Paragraph({
              tabStops: [{ type: TabStopType.RIGHT, position: rightTab }],
              spacing: { before: 60 },
              children: [
                new TextRun({ ...bodyRun, text: String(ed.school || ""), bold: true }),
                new TextRun({ ...bodyRun, children: [new Tab(), String(ed.period || "")], color: "6b7280" }),
              ],
            }),
          );
          if (ed.degree) children.push(new Paragraph({ children: [new TextRun({ ...bodyRun, text: String(ed.degree), italics: true, color: headingColor })] }));
        }
      }
    }

    const doc = new Document({
      styles: { default: { document: { run: { font, size: baseSize } } } },
      sections: [
        {
          properties: {
            page: {
              size: { width: Math.round(PAGE_IN[paper].w * TWIPS_PER_IN), height: Math.round(PAGE_IN[paper].h * TWIPS_PER_IN) },
              margin: { top: marginTwips, bottom: marginTwips, left: marginTwips, right: marginTwips },
            },
          },
          children,
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);
    const rawName = String(body.fileName || "resume.docx").replace(/[^\w.\- ]+/g, "_");
    const fileName = rawName.toLowerCase().endsWith(".docx") ? rawName : `${rawName.replace(/\.(pdf|doc)$/i, "")}.docx`;

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("Content-Length", buffer.length);
    return res.end(buffer);
  } catch (err) {
    console.error("POST /api/personal/resume-docx failed:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
