import PizZip from "pizzip";
import { fuzzyCompanyMatch } from "./parseTemplateDocx.js";
import { cloneParaWithRichText, replacePlaceholderWithRichText } from "./ooxmlRichText.js";

const PARA_RE = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
const BODY_RE = /<w:body\b([^>]*)>([\s\S]*?)<\/w:body>/;

function cleanString(v) {
  return String(v ?? "").trim();
}

function normalizeSections(sections) {
  const obj = (v) => (v && typeof v === "object" ? v : {});
  const summarySec = obj(sections?.summary);
  const skillsSec = obj(sections?.skills);
  const expSec = obj(sections?.experience);

  const summary = typeof summarySec.summary === "string" ? summarySec.summary : cleanString(summarySec.summary);

  const skillsArr = Array.isArray(skillsSec.skills) ? skillsSec.skills : [];
  const skills = skillsArr
    .map((g) => {
      const row = obj(g);
      const items = Array.isArray(row.items) ? row.items.map(String) : [];
      return { category: String(row.category ?? ""), items };
    })
    .filter((g) => g.category || g.items.length);

  const expArr = Array.isArray(expSec.experiences)
    ? expSec.experiences
    : Array.isArray(expSec.experience)
      ? expSec.experience
      : [];
  const experiences = expArr.map((e) => {
    const row = obj(e);
    return {
      company: String(row.company ?? ""),
      title: String(row.title ?? row.role ?? ""),
      bullets: Array.isArray(row.bullets) ? row.bullets.map(String).filter(Boolean) : [],
    };
  });

  return { summary, skills, experiences };
}

function formatSkills(skills) {
  return skills
    .map((g) => {
      const items = g.items.join(", ");
      return g.category ? `${g.category}: ${items}` : items;
    })
    .join("; ");
}

function resolveExperienceForSlot(slot, experiences, used) {
  if (slot.experienceIndex != null && experiences[slot.experienceIndex] && !used.has(slot.experienceIndex)) {
    used.add(slot.experienceIndex);
    return experiences[slot.experienceIndex];
  }
  if (slot.companyHint) {
    const idx = experiences.findIndex((e, i) => !used.has(i) && fuzzyCompanyMatch(e.company, slot.companyHint));
    if (idx >= 0) {
      used.add(idx);
      return experiences[idx];
    }
  }
  const next = experiences.findIndex((_, i) => !used.has(i));
  if (next >= 0) {
    used.add(next);
    return experiences[next];
  }
  return null;
}

function extractParagraphs(xml) {
  return [...xml.matchAll(PARA_RE)].map((m) => m[0]);
}

function extractSectPr(bodyInner) {
  const m = bodyInner.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/);
  return m ? m[0] : "";
}

function rebuildBodyFromParagraphs(xml, paragraphs) {
  const match = xml.match(BODY_RE);
  if (!match) return xml;
  const sectPr = extractSectPr(match[2]);
  const newInner = paragraphs.join("") + sectPr;
  return xml.replace(BODY_RE, `<w:body${match[1]}>${newInner}</w:body>`);
}

function fillPlaceholder(paraXml, markdownText) {
  const next = replacePlaceholderWithRichText(paraXml, markdownText);
  return next && next !== paraXml ? next : null;
}

/**
 * Fill `{}` placeholders in a DOCX template with generated sections.
 * @param {Buffer} buffer
 * @param {object} manifest
 * @param {object} sections
 * @returns {{ buffer: Buffer, warnings: string[] }}
 */
export function fillTemplateDocx(buffer, manifest, sections) {
  const zip = new PizZip(buffer);
  const docFile = zip.file("word/document.xml");
  if (!docFile) throw new Error("Invalid DOCX: missing word/document.xml");

  const originalXml = docFile.asText();
  const paragraphs = extractParagraphs(originalXml);
  const normalized = normalizeSections(sections);
  const warnings = [...(manifest.warnings || [])];
  const usedExperiences = new Set();
  const slots = Array.isArray(manifest.slots) ? [...manifest.slots] : [];
  const ordered = [...slots].sort((a, b) => b.paragraphIndex - a.paragraphIndex);

  for (const slot of ordered) {
    const idx = slot.paragraphIndex;
    const para = paragraphs[idx];
    if (!para) {
      warnings.push(`Slot ${slot.index}: paragraph ${idx} not found.`);
      continue;
    }

    if (slot.section === "summary") {
      const text = normalized.summary || "";
      if (!text) warnings.push("Summary slot unfilled: no generated summary.");
      const next = fillPlaceholder(para, text);
      if (!next) warnings.push(`Summary slot ${slot.index}: could not replace {}.`);
      else paragraphs[idx] = next;
      continue;
    }

    if (slot.section === "skills") {
      const text = formatSkills(normalized.skills);
      if (!text) warnings.push("Skills slot unfilled: no generated skills.");
      const next = fillPlaceholder(para, text);
      if (!next) warnings.push(`Skills slot ${slot.index}: could not replace {}.`);
      else paragraphs[idx] = next;
      continue;
    }

    if (slot.section === "experience") {
      const exp = resolveExperienceForSlot(slot, normalized.experiences, usedExperiences);
      if (!exp) {
        warnings.push(`Experience slot ${slot.index}${slot.companyHint ? ` (${slot.companyHint})` : ""}: no matching AI content.`);
        continue;
      }
      const bullets = exp.bullets.length ? exp.bullets : [""];
      const filled = fillPlaceholder(para, bullets[0]);
      if (!filled) {
        warnings.push(`Experience slot ${slot.index}: could not replace {}.`);
        continue;
      }
      paragraphs[idx] = filled;
      if (bullets.length > 1 && slot.isBullet) {
        const inserts = [];
        for (let b = 1; b < bullets.length; b += 1) {
          inserts.push(cloneParaWithRichText(para, bullets[b]));
        }
        paragraphs.splice(idx + 1, 0, ...inserts);
      } else if (bullets.length > 1) {
        warnings.push(`Experience slot ${slot.index}: extra bullets merged into first line (non-bullet slot).`);
        const merged = bullets.map((b) => `• ${b}`).join(" ");
        const mergedPara = fillPlaceholder(para, merged);
        if (mergedPara) paragraphs[idx] = mergedPara;
      }
    }
  }

  const outXml = rebuildBodyFromParagraphs(originalXml, paragraphs);
  zip.file("word/document.xml", outXml);
  return { buffer: zip.generate({ type: "nodebuffer" }), warnings };
}

export { extractParagraphs, rebuildBodyFromParagraphs };
