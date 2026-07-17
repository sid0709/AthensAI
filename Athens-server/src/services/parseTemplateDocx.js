import * as cheerio from "cheerio";
import PizZip from "pizzip";

const SECTION_SYNONYMS = {
  summary: ["SUMMARY", "PROFILE", "OBJECTIVE", "PROFESSIONAL SUMMARY", "EXECUTIVE SUMMARY"],
  experience: ["EXPERIENCE", "WORK HISTORY", "EMPLOYMENT", "PROFESSIONAL EXPERIENCE", "WORK EXPERIENCE", "CAREER HISTORY"],
  skills: ["SKILLS", "TECHNICAL SKILLS", "CORE COMPETENCIES", "TECHNOLOGIES", "KEY SKILLS", "TECHNICAL PROFICIENCIES"],
  education: ["EDUCATION", "ACADEMIC", "ACADEMIC BACKGROUND"],
};

function cleanString(v) {
  return String(v ?? "").trim();
}

function stripNamespaces(xml) {
  return xml
    .replace(/\sxmlns(?::\w+)?="[^"]*"/g, "")
    .replace(/(<\/?)(?:w\d*:|w14:)/g, "$1");
}

function normalizeHeading(text) {
  return cleanString(text).toUpperCase().replace(/[^A-Z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function classifyHeading(text) {
  const norm = normalizeHeading(text);
  if (!norm) return null;
  for (const [section, synonyms] of Object.entries(SECTION_SYNONYMS)) {
    for (const syn of synonyms) {
      if (norm === syn || norm.startsWith(`${syn} `) || norm.endsWith(` ${syn}`)) return section;
    }
  }
  return null;
}

function normalizeCompany(name) {
  return cleanString(name)
    .toLowerCase()
    .replace(/[,.']/g, "")
    .replace(/\b(inc|llc|corp|corporation|ltd|co|company)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function fuzzyCompanyMatch(a, b) {
  const na = normalizeCompany(a);
  const nb = normalizeCompany(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  return false;
}

function paraText($, el) {
  const texts = [];
  $(el)
    .find("t")
    .each((_, t) => {
      texts.push($(t).text());
    });
  return texts.join("");
}

function hasBullet($, el) {
  return $(el).find("numPr").length > 0;
}

function isItalicPara($, el) {
  const runs = $(el).find("r");
  if (!runs.length) return false;
  let hasText = false;
  let allItalic = true;
  runs.each((_, r) => {
    const t = $(r).find("t").text();
    if (!t.trim()) return;
    hasText = true;
    if ($(r).find("i").length === 0) allItalic = false;
  });
  return hasText && allItalic;
}

function isBoldPara($, el) {
  const runs = $(el).find("r");
  if (!runs.length) return false;
  let hasText = false;
  let anyBold = false;
  runs.each((_, r) => {
    const t = $(r).find("t").text();
    if (!t.trim()) return;
    hasText = true;
    if ($(r).find("b").length > 0) anyBold = true;
  });
  return hasText && anyBold;
}

function looksLikeTitleDateLine(text) {
  const t = cleanString(text);
  if (!t) return false;
  return /\d{4}/.test(t) && (t.includes("–") || t.includes("-") || /present/i.test(t));
}

function extractCompanyHint($, blocks, slotParaIndex) {
  for (let i = slotParaIndex - 1; i >= 0; i -= 1) {
    const b = blocks[i];
    if (b.hasPlaceholder) break;
    if (b.sectionHeading === "experience") break;
    if (looksLikeTitleDateLine(b.text) && isBoldPara($, b.el)) continue;
    if (isItalicPara($, b.el)) return cleanString(b.text);
    if (b.text && !looksLikeTitleDateLine(b.text) && !b.isHeading) return cleanString(b.text);
  }
  for (let i = slotParaIndex - 1; i >= 0; i -= 1) {
    const b = blocks[i];
    if (b.hasPlaceholder || b.sectionHeading === "experience") break;
    if (b.text) return cleanString(b.text);
  }
  return undefined;
}

function classifySlotSection(blocks, slotParaIndex) {
  for (let i = slotParaIndex - 1; i >= 0; i -= 1) {
    const b = blocks[i];
    if (b.sectionHeading && b.sectionHeading !== "education") return b.sectionHeading;
    if (b.isHeading) {
      const cls = classifyHeading(b.text);
      if (cls && cls !== "education") return cls;
    }
  }
  return "summary";
}

function loadDocument($, xml) {
  const stripped = stripNamespaces(xml);
  return cheerio.load(stripped, { xmlMode: true, decodeEntities: false });
}

/**
 * Parse a DOCX buffer and return slot manifest for `{}` placeholders.
 * @param {Buffer} buffer
 * @param {{ careers?: { company?: string }[] }} [identity]
 */
export function parseTemplateDocx(buffer, identity = {}) {
  const zip = new PizZip(buffer);
  const docFile = zip.file("word/document.xml");
  if (!docFile) throw new Error("Invalid DOCX: missing word/document.xml");

  const xml = docFile.asText();
  const $ = loadDocument(cheerio, xml);

  const body = $("body").first();
  const children = body.children().toArray();
  const blocks = [];

  children.forEach((el, idx) => {
    const tag = (el.tagName || el.name || "").toLowerCase();
    if (tag !== "p") return;
    const text = paraText($, el);
    const headingCls = classifyHeading(text);
    const isHeading = Boolean(headingCls) && text.length < 80;
    blocks.push({
      index: idx,
      el,
      text,
      isHeading,
      sectionHeading: isHeading ? headingCls : null,
      isBullet: hasBullet($, el),
      hasPlaceholder: text.includes("{}"),
    });
  });

  const warnings = [];
  const slots = [];
  let slotIndex = 0;

  for (const b of blocks) {
    if (!b.hasPlaceholder) continue;

    const section = classifySlotSection(blocks, b.index);
    const slot = {
      index: slotIndex,
      paragraphIndex: b.index,
      section,
      isBullet: b.isBullet,
      companyHint: undefined,
      experienceIndex: undefined,
    };

    if (section === "experience") {
      slot.companyHint = extractCompanyHint($, blocks, b.index);
      const careers = Array.isArray(identity.careers) ? identity.careers : [];
      const matchIdx = careers.findIndex((c) => fuzzyCompanyMatch(c?.company, slot.companyHint));
      if (matchIdx >= 0) slot.experienceIndex = matchIdx;
    }

    slots.push(slot);
    slotIndex += 1;
  }

  if (!slots.length) throw new Error("Template must contain at least one {} placeholder.");

  const sectionsFound = [...new Set(slots.map((s) => s.section).filter((s) => s !== "education"))];
  for (const sec of ["summary", "skills", "experience"]) {
    if (!sectionsFound.includes(sec)) warnings.push(`No {} placeholder found in ${sec} section.`);
  }

  const expSlots = slots.filter((s) => s.section === "experience");
  const careers = Array.isArray(identity.careers) ? identity.careers : [];
  if (expSlots.length && careers.length && expSlots.length !== careers.length) {
    warnings.push(`Experience placeholders (${expSlots.length}) do not match profile careers (${careers.length}).`);
  }
  for (const s of expSlots) {
    if (s.companyHint && careers.length && s.experienceIndex == null) {
      warnings.push(`Could not match company "${s.companyHint}" to profile careers.`);
    }
  }

  return {
    slotCount: slots.length,
    sectionsFound,
    slots,
    warnings,
  };
}

export { normalizeCompany, fuzzyCompanyMatch, stripNamespaces, loadDocument };
