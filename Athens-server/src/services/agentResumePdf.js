// Server-side résumé PDF for agent / Job Search runs — config-driven so it matches
// the Resume Generator preview (templateId, layout order, theme font/sizes/colors).
// The Profile page renders its PDF from the live React preview via puppeteer; here
// we mirror that TemplateDef catalog + theme + layout from generated sections, then
// feed the same paged-Chromium renderer (htmlToPdf).

import { htmlToPdf } from "../controllers/resumePdfController.js";
import { templateById } from "../config/resumeTemplates.js";
import { writeAgentDraftPdf } from "./agentResumeDraftService.js";

const esc = (v) =>
  String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const clean = (v) => String(v ?? "").trim();
// Escape, then render the inline markdown the generator emits (**bold**, *italic*) — matches
// the preview's renderRich instead of showing literal asterisks.
const md = (v) =>
  esc(v).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");

const SECTION_LABEL = { summary: "Summary", experience: "Experience", skills: "Skills", education: "Education" };
const DEFAULT_LAYOUT = [{ type: "summary" }, { type: "experience" }, { type: "skills" }, { type: "education" }];
const MUTED_HEADING = "#6b7280";

const SERIF = new Set(["Georgia", "Times New Roman", "Garamond", "Cambria", "Source Serif 4", "Merriweather", "Lora", "PT Serif"]);
function fontStack(name) {
  if (!name) return "sans-serif";
  if (name.includes(",")) return name;
  const generic = SERIF.has(name) ? "serif" : "sans-serif";
  return `${/\s/.test(name) ? `"${name}"` : name}, ${generic}`;
}
// Google-Fonts stylesheet link for a web font (skip system serif/sans families).
function fontLinks(name) {
  if (!name || SERIF.has(name) || ["Arial", "Helvetica"].includes(name)) return [];
  const fam = name.replace(/\s+/g, "+");
  return [`https://fonts.googleapis.com/css2?family=${fam}:ital,wght@0,400;0,600;0,700;1,400&display=swap`];
}

function resolveHeadingColor(template, sectionColor, textColor) {
  if (template.headingMuted) return MUTED_HEADING;
  if (template.headingColor === "text") return textColor;
  return sectionColor;
}

function headingHtml(template, label, color, size) {
  const titleCase = template.headingCase === "title";
  const parts = [
    `font-size:${size}pt`,
    "font-weight:700",
    `color:${color}`,
    `text-transform:${titleCase ? "none" : "uppercase"}`,
    `letter-spacing:${titleCase ? "0" : ".08em"}`,
    "margin-bottom:7px",
    `text-align:${template.headingAlign || "left"}`,
    "break-after:avoid",
  ];
  if (template.heading === "underline") {
    parts.push(`border-bottom:1.5px solid ${color}`, "padding-bottom:3px");
  } else if (template.heading === "bar") {
    parts.push(`border-left:3px solid ${color}`, "padding-left:8px");
  } else if (template.heading === "centered-rules") {
    parts.push(
      "text-align:center",
      `border-top:1px solid ${color}`,
      `border-bottom:1px solid ${color}`,
      "padding:3px 0",
    );
  } else {
    parts.push("padding-bottom:1px");
  }
  return `<div style="${parts.join(";")}">${esc(label)}</div>`;
}

function metaSpan(t, size, italic) {
  return t
    ? `<span style="opacity:.72;white-space:nowrap;font-size:${size}pt;${italic ? "font-style:italic;" : ""}">${esc(t)}</span>`
    : "";
}

function flexRow(left, right) {
  return `<div style="display:flex;justify-content:space-between;gap:12px;align-items:baseline;">${left}${right}</div>`;
}

function bulletsHtml(bullets, bodySize) {
  if (!bullets.length) return "";
  return `<ul style="list-style:disc;margin:2px 0 0;padding-left:18px;">${bullets
    .map((b) => `<li style="margin-bottom:1px;break-inside:avoid;text-align:justify;font-size:${bodySize}pt;">${md(b)}</li>`)
    .join("")}</ul>`;
}

/** Experience entry HTML — mirrors preview/experience-entry.tsx layouts. */
function experienceEntryHtml(e, layout, bodySize, accent) {
  const company = clean(e?.company) || "Company";
  const title = clean(e?.title) || "Role";
  const period = clean(e?.period);
  const loc = clean(e?.location);
  const bullets = Array.isArray(e?.bullets) ? e.bullets.map(clean).filter(Boolean) : [];
  const meta = Math.max(8, bodySize - 1);
  const datesLoc = [period, loc].filter(Boolean).join(", ");

  if (layout === "two-col-entry") {
    return `<div style="display:flex;gap:20px;margin-bottom:10px;font-size:${bodySize}pt;">
      <div style="width:32%;flex-shrink:0;">
        <div style="font-weight:700;">${esc(title)}</div>
        <div style="opacity:.6;font-size:${meta}pt;">${esc(period)}</div>
      </div>
      <div style="flex:1;min-width:0;">
        <div style="margin-bottom:3px;"><span style="font-weight:700;">${esc(company)}</span>${loc ? `<span style="opacity:.7;"> | ${esc(loc)}</span>` : ""}</div>
        ${bullets.map((b) => `<p style="margin:0 0 2px;text-align:justify;break-inside:avoid;">${md(b)}</p>`).join("")}
      </div>
    </div>`;
  }

  if (layout === "dev") {
    return `<div style="border-bottom:1px solid #e5e7eb;padding-bottom:8px;margin-bottom:10px;font-size:${bodySize}pt;">
      <div style="break-after:avoid;"><span style="font-weight:700;">${esc(company)}</span> <span style="opacity:.55;">${esc(title)}</span></div>
      ${bulletsHtml(bullets, bodySize)}
      ${datesLoc ? `<div style="opacity:.5;font-size:${meta}pt;margin-top:4px;">${esc(datesLoc)}</div>` : ""}
    </div>`;
  }

  let head = "";
  switch (layout) {
    case "standard":
      head = `<div style="font-weight:700;">${esc(title)}</div>${flexRow(`<span style="font-weight:700;">${esc(company)}</span>`, metaSpan(datesLoc, meta))}`;
      break;
    case "single-line":
      head = `<div style="font-weight:700;">${esc([title, company, loc, period].filter(Boolean).join("  |  "))}</div>`;
      break;
    case "modern":
      head = `<div><span style="font-weight:700;color:${accent};">${esc(title)}</span><span style="font-weight:700;"> | ${esc(company)}</span></div>
        <div style="opacity:.6;font-size:${meta}pt;">${esc(datesLoc)}</div>`;
      break;
    case "harvard":
      head = `${flexRow(`<span style="font-weight:700;">${esc(company)}</span>`, metaSpan(loc, meta))}
        ${flexRow(`<span style="font-weight:700;">${esc(title)}</span>`, metaSpan(period, meta))}`;
      break;
    case "jakes":
      head = `${flexRow(`<span style="font-weight:700;">${esc(company)}</span>`, metaSpan(loc, meta))}
        ${flexRow(`<span style="font-style:italic;">${esc(title)}</span>`, metaSpan(period, meta, true))}`;
      break;
    default: // "default"
      head = `${flexRow(`<span style="font-weight:700;">${esc(title)}</span>`, metaSpan(period, meta))}
        <div style="font-style:italic;color:${accent};margin-bottom:2px;">${esc(company)}</div>`;
  }

  return `<div style="margin-bottom:10px;font-size:${bodySize}pt;">
    <div style="break-after:avoid;">${head}</div>
    ${bulletsHtml(bullets, bodySize)}
  </div>`;
}

function sectionBodyHtml(type, sections, identity, bodySize, color, template) {
  if (type === "summary") {
    const s = clean(sections?.summary?.summary ?? sections?.summary);
    return s ? `<p style="margin:0;text-align:justify;font-size:${bodySize}pt;">${md(s)}</p>` : "";
  }
  if (type === "skills") {
    const groups = Array.isArray(sections?.skills?.skills) ? sections.skills.skills : [];
    const rows = groups
      .map((g) => {
        const items = Array.isArray(g?.items) ? g.items.map(clean).filter(Boolean) : [];
        if (!items.length) return "";
        const cat = clean(g?.category);
        return `<div style="margin-bottom:3px;font-size:${bodySize}pt;">${cat ? `<span style="font-weight:700;color:${color};">${md(cat)}:</span> ` : ""}${md(items.join(", "))}</div>`;
      })
      .filter(Boolean);
    return rows.join("");
  }
  if (type === "experience") {
    const exps = sections?.experience?.experiences ?? sections?.experience?.experience;
    if (!Array.isArray(exps) || !exps.length) return "";
    return exps.map((e) => experienceEntryHtml(e, template.experienceLayout || "default", bodySize, color)).join("");
  }
  if (type === "education") {
    const list =
      Array.isArray(identity?.education) && identity.education.length
        ? identity.education
        : Array.isArray(sections?.education?.education)
          ? sections.education.education
          : Array.isArray(sections?.education?.educations)
            ? sections.education.educations
            : [];
    if (!list.length) return "";
    const meta = Math.max(8, bodySize - 1);
    return list
      .map((e) => {
        const school = clean(e?.school);
        const degree = clean(e?.degree);
        const period = clean(e?.period);
        return `<div style="break-inside:avoid;margin-bottom:8px;font-size:${bodySize}pt;">
            ${flexRow(`<span style="font-weight:700;">${esc(school)}</span>`, metaSpan(period, meta))}
            ${degree ? `<div style="font-style:italic;color:${color};">${esc(degree)}</div>` : ""}
          </div>`;
      })
      .join("");
  }
  return "";
}

// Tiny lucide-like icons for contactIcons templates (map / mail / phone / linkedin).
function contactIcon(kind, px) {
  const s = `width:${px}px;height:${px}px;opacity:.7;flex-shrink:0;vertical-align:middle;`;
  if (kind === "map") {
    return `<svg style="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>`;
  }
  if (kind === "mail") {
    return `<svg style="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>`;
  }
  if (kind === "phone") {
    return `<svg style="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`;
  }
  return `<svg style="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6z"/><rect width="4" height="12" x="2" y="9"/><circle cx="4" cy="4" r="2"/></svg>`;
}

function headerHtml(identity, theme, template) {
  const id = identity || {};
  const text = theme.text || "#0f172a";
  const accent = theme.accent || text;
  const nameSize = Number(theme.nameSize) || 24;
  const baseSize = Number(theme.baseSize) || 10.5;
  const headerAlign = theme.headerAlign || template.defaultHeaderAlign || "center";
  const nameColor = template.nameColor === "accent" ? accent : text;
  const name = clean(id.fullName);
  const contactSize = Math.max(8, baseSize - 1.5);
  const iconPx = Math.round(baseSize * 1.25);

  const contacts = [
    { kind: "map", text: clean(id.location) },
    { kind: "mail", text: clean(id.email) },
    { kind: "phone", text: clean(id.phone) },
    { kind: "linkedin", text: clean(id.linkedin) },
  ].filter((c) => c.text);

  const nameStyle = [
    `font-size:${nameSize}pt`,
    "font-weight:700",
    `letter-spacing:${template.nameUppercase ? ".04em" : ".01em"}`,
    `color:${nameColor}`,
    "line-height:1.1",
    `text-transform:${template.nameUppercase ? "uppercase" : "none"}`,
  ].join(";");

  const nameEl = `<div style="${nameStyle}">${esc(name)}</div>`;

  let contactEl = "";
  if (contacts.length) {
    if (template.contactIcons) {
      const justify = template.labelGutter ? "flex-start" : headerAlign === "center" ? "center" : "flex-start";
      contactEl = `<div style="font-size:${contactSize}pt;color:${text};opacity:.85;display:flex;flex-wrap:wrap;gap:4px 16px;justify-content:${justify};">
        ${contacts
          .map(
            (c) =>
              `<span style="display:inline-flex;align-items:center;gap:4px;">${contactIcon(c.kind, iconPx)}${esc(c.text)}</span>`,
          )
          .join("")}
      </div>`;
    } else {
      contactEl = `<div style="font-size:${contactSize}pt;color:${text};opacity:.85;">${contacts.map((c) => esc(c.text)).join("&nbsp;&nbsp;•&nbsp;&nbsp;")}</div>`;
    }
  }

  if (template.labelGutter) {
    return `<div style="display:flex;align-items:baseline;gap:24px;margin-bottom:18px;">${nameEl}<div style="flex:1;min-width:0;">${contactEl}</div></div>`;
  }

  const rule = template.nameRule
    ? `<div style="border-bottom:1px solid ${accent};opacity:.5;margin:8px 0;"></div>`
    : "";
  const contactWrap = contactEl
    ? `<div style="margin-top:${template.nameRule ? 0 : 6}px;">${contactEl}</div>`
    : "";
  return `<header style="text-align:${headerAlign};margin-bottom:18px;">${nameEl}${rule}${contactWrap}</header>`;
}

function sectionBlockHtml(sec, sections, identity, template, textColor) {
  const type = sec.type;
  if (!SECTION_LABEL[type]) return "";
  const bodySize = Number(sec.bodySize) || 10.5;
  const titleSize = Number(sec.titleSize) || 12;
  const sectionColor = sec.titleColor || textColor;
  const color = resolveHeadingColor(template, sectionColor, textColor);
  const inner = sectionBodyHtml(type, sections, identity, bodySize, color, template);
  if (!inner) return "";
  const heading = headingHtml(template, SECTION_LABEL[type], color, titleSize);
  if (template.labelGutter) {
    return `<div style="display:flex;gap:24px;margin-bottom:14px;">
      <div style="width:22%;flex-shrink:0;">${heading}</div>
      <div style="flex:1;min-width:0;">${inner}</div>
    </div>`;
  }
  return `<div style="margin-bottom:14px;">${heading}${inner}</div>`;
}

/** Build résumé body HTML mirroring the saved templateId + theme + layout order. */
export function sectionsToHtml(sections, identity, config) {
  const theme = (config && config.theme) || {};
  const template = templateById(config?.templateId);
  const layout = Array.isArray(config?.layout) && config.layout.length ? config.layout : DEFAULT_LAYOUT;
  const text = theme.text || "#0f172a";
  const accent = theme.accent || text;

  const parts = [];
  if (template.topBar) {
    parts.push(`<div style="height:10px;background:${accent};border-radius:2px;margin-bottom:16px;"></div>`);
  }
  if (template.cornerAccent) {
    parts.push(
      `<div style="position:absolute;top:0;right:0;width:55%;height:150px;background:${accent}14;clip-path:polygon(100% 0,100% 100%,0 0);"></div>`,
    );
  }

  parts.push(`<div style="position:relative;">${headerHtml(identity, theme, template)}</div>`);

  const renderSections = (secs) => secs.map((sec) => sectionBlockHtml(sec, sections, identity, template, text)).join("");

  if (template.columns === 2) {
    const sidebarSecs = layout.filter((s) => (template.sidebar || []).includes(s.type));
    const mainSecs = layout.filter((s) => !(template.sidebar || []).includes(s.type));
    const tint = template.sidebarTint
      ? `background:${accent}10;padding:14px;border-radius:4px;${template.sidebarSide === "left" ? "margin-left:-6px;" : ""}`
      : "";
    const dir = template.sidebarSide === "left" ? "row" : "row-reverse";
    parts.push(`<div style="position:relative;display:flex;gap:24px;flex-direction:${dir};">
      <div style="width:${template.sidebarWidthPct || 34}%;flex-shrink:0;${tint}">${renderSections(sidebarSecs)}</div>
      <div style="flex:1;min-width:0;">${renderSections(mainSecs)}</div>
    </div>`);
  } else {
    parts.push(`<div style="position:relative;">${renderSections(layout)}</div>`);
  }

  // Absolute corner accent needs a positioned root when present.
  if (template.cornerAccent) {
    return `<div style="position:relative;overflow:hidden;">${parts.join("\n")}</div>`;
  }
  return parts.join("\n");
}

/**
 * Render the generated résumé to a PDF buffer (same pipeline + saved config as the Profile
 * page) and save a copy to a timestamped review folder. Returns { buffer, savedPath, reviewPath }.
 */
export async function renderAgentResumePdf({
  sections,
  identity,
  applierName,
  jobId,
  config,
  titlePolicyFingerprint,
  identityFingerprint,
  skipReviewCopy = false,
}) {
  const theme = (config && config.theme) || {};
  const html = sectionsToHtml(sections, identity, config);
  const buffer = await htmlToPdf({
    html,
    paper: theme.paper === "a4" ? "a4" : "letter",
    marginInches: Number(theme.margin) || 0.65,
    font: fontStack(theme.font),
    baseSizePt: Number(theme.baseSize) || 10.5,
    fontLinks: fontLinks(theme.font),
  });

  const { draftPath, reviewPath } = await writeAgentDraftPdf({
    buffer,
    applierName,
    jobId,
    html,
    config,
    titlePolicyFingerprint: titlePolicyFingerprint ?? config?.titlePolicyFingerprint,
    identityFingerprint: identityFingerprint ?? config?.identityFingerprint,
    skipReviewCopy,
  });
  return { buffer, savedPath: draftPath, reviewPath };
}
