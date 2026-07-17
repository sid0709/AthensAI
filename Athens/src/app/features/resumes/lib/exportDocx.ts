import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
} from "docx";
import { saveAs } from "file-saver";
import type { ResumeDocument } from "../../../types/resume";

export async function exportDocumentToDocx(doc: ResumeDocument, fileName: string) {
  const { identity, summary, experiences, skills, education } = doc;

  const children: Paragraph[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: identity.fullName, bold: true, size: 48 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: [identity.location, identity.email, identity.phone, identity.linkedin].filter(Boolean).join(" · "),
          size: 20,
        }),
      ],
    }),
    new Paragraph({ text: "" }),
    new Paragraph({ text: "Summary", heading: HeadingLevel.HEADING_2 }),
    new Paragraph({ children: [new TextRun({ text: summary, size: 22 })] }),
    new Paragraph({ text: "" }),
    new Paragraph({ text: "Experience", heading: HeadingLevel.HEADING_2 }),
  ];

  for (const exp of experiences) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({ text: exp.role, bold: true, size: 24 }),
          new TextRun({ text: ` — ${exp.company}`, size: 24 }),
        ],
      }),
      new Paragraph({
        children: [new TextRun({ text: `${exp.startDate} – ${exp.endDate} · ${exp.location}`, italics: true, size: 20 })],
      })
    );
    for (const bullet of exp.bullets) {
      children.push(new Paragraph({ text: `• ${bullet}`, bullet: { level: 0 } }));
    }
    children.push(new Paragraph({ text: "" }));
  }

  children.push(new Paragraph({ text: "Skills", heading: HeadingLevel.HEADING_2 }));
  const skillLines = [
    ["Languages", skills.languages],
    ["Frameworks", skills.frameworks],
    ["Databases", skills.databases],
    ["Cloud & DevOps", skills.cloudDevOps],
  ];
  for (const [label, items] of skillLines) {
    if (items.length) {
      children.push(new Paragraph({ children: [new TextRun({ text: `${label}: ${items.join(", ")}`, size: 22 })] }));
    }
  }

  children.push(new Paragraph({ text: "" }));
  children.push(new Paragraph({ text: "Education", heading: HeadingLevel.HEADING_2 }));
  for (const edu of education) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({ text: edu.degree, bold: true, size: 24 }),
          new TextRun({ text: ` — ${edu.school}`, size: 24 }),
        ],
      }),
      new Paragraph({ children: [new TextRun({ text: `${edu.graduationDate} · ${edu.location}`, size: 20 })] })
    );
  }

  const document = new Document({ sections: [{ children }] });
  const blob = await Packer.toBlob(document);
  saveAs(blob, fileName);
}
