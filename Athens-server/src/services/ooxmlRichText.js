export function xmlEscape(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function splitMarkdownSegments(text) {
  const parts = String(text ?? "").split(/(\*\*[^*]+?\*\*)/g);
  return parts
    .filter((p) => p.length > 0)
    .map((p) => {
      const bold = /^\*\*[^*]+?\*\*$/.test(p);
      return { text: bold ? p.slice(2, -2) : p, bold };
    });
}

function runText(runXml) {
  const texts = [];
  const re = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;
  let m;
  while ((m = re.exec(runXml)) !== null) texts.push(m[1]);
  return texts.join("");
}

function extractRPr(runXml) {
  const m = runXml.match(/<w:rPr[\s\S]*?<\/w:rPr>/);
  return m ? m[0] : "";
}

function withBold(rPr) {
  if (!rPr) return "<w:rPr><w:b/></w:rPr>";
  if (/<w:b\b/.test(rPr)) return rPr;
  return rPr.replace("</w:rPr>", "<w:b/></w:rPr>");
}

function textNode(text) {
  const escaped = xmlEscape(text);
  const preserve = /^\s|\s$/.test(escaped) ? ' xml:space="preserve"' : "";
  return `<w:t${preserve}>${escaped}</w:t>`;
}

export function buildRunsXml(baseRPr, segments) {
  return segments
    .map((seg) => {
      if (!seg.text) return "";
      const rPr = seg.bold ? withBold(baseRPr) : baseRPr;
      return `<w:r>${rPr}${textNode(seg.text)}</w:r>`;
    })
    .filter(Boolean)
    .join("");
}

function replaceRunPlaceholder(runXml, markdownText) {
  const combined = runText(runXml);
  if (!combined.includes("{}")) return null;

  const baseRPr = extractRPr(runXml);
  const segments = splitMarkdownSegments(markdownText);
  if (!segments.length) return null;

  // Entire run is only `{}` (possibly split in one t node).
  if (combined === "{}") {
    return buildRunsXml(baseRPr, segments);
  }

  // `{}` embedded in larger run text — split segments around literal parts.
  const beforeAfter = combined.split("{}");
  if (beforeAfter.length !== 2) return null;
  const [before, after] = beforeAfter;
  const out = [];
  if (before) out.push({ text: before, bold: false });
  out.push(...segments);
  if (after) out.push({ text: after, bold: false });
  return buildRunsXml(baseRPr, out);
}

const RUN_RE = /<w:r\b[^>]*>[\s\S]*?<\/w:r>/g;

/**
 * Replace `{}` in a paragraph with markdown-aware OOXML runs, preserving w:rPr.
 */
export function replacePlaceholderWithRichText(paraXml, markdownText) {
  if (!paraXml || !markdownText) return paraXml;

  // `{}` split across two runs: `{` in one, `}` in next.
  const splitAcrossRuns =
    /<w:r\b[^>]*>[\s\S]*?<w:t[^>]*>\{<\/w:t>[\s\S]*?<\/w:r>\s*<w:r\b[^>]*>[\s\S]*?<w:t[^>]*>\}<\/w:t>[\s\S]*?<\/w:r>/;
  if (splitAcrossRuns.test(paraXml)) {
    const firstRun = paraXml.match(/<w:r\b[^>]*>[\s\S]*?<w:t[^>]*>\{<\/w:t>[\s\S]*?<\/w:r>/);
    const baseRPr = firstRun ? extractRPr(firstRun[0]) : "";
    const newRuns = buildRunsXml(baseRPr, splitMarkdownSegments(markdownText));
    return paraXml.replace(splitAcrossRuns, newRuns);
  }

  RUN_RE.lastIndex = 0;
  let m;
  while ((m = RUN_RE.exec(paraXml)) !== null) {
    const replacement = replaceRunPlaceholder(m[0], markdownText);
    if (!replacement) continue;
    return paraXml.slice(0, m.index) + replacement + paraXml.slice(m.index + m[0].length);
  }

  return paraXml;
}

/**
 * Clone a paragraph template and fill `{}` with rich text (for extra bullets).
 */
export function cloneParaWithRichText(paraXml, markdownText) {
  return replacePlaceholderWithRichText(paraXml, markdownText);
}
