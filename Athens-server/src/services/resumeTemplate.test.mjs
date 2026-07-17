import { readFileSync } from "fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTemplateDocx, fuzzyCompanyMatch } from "./parseTemplateDocx.js";
import { fillTemplateDocx, extractParagraphs } from "./fillTemplateDocx.js";
import { replacePlaceholderWithRichText } from "./ooxmlRichText.js";

const SAMPLE = "/Users/robin/Downloads/Eli_Taylor (1).docx";

const identity = {
  careers: [
    { company: "McGrow Hill", title: "Senior Software Engineer" },
    { company: "Accolade, Inc", title: "Senior Software Engineer" },
    { company: "WSECU", title: "Software Engineer" },
    { company: "Robert Half", title: "Software Engineer" },
  ],
};

function baseSections(overrides = {}) {
  return {
    summary: { summary: "Experienced engineer with strong backend skills." },
    skills: {
      skills: [
        { category: "Languages", items: ["TypeScript", "Python"] },
        { category: "Cloud", items: ["AWS", "Azure"] },
      ],
    },
    experience: {
      experiences: [
        {
          company: "McGrow Hill",
          title: "Senior Software Engineer",
          bullets: ["Led platform migration.", "Improved API latency 40%.", "Mentored 3 engineers.", "Owned CI/CD pipeline."],
        },
        {
          company: "Accolade, Inc",
          title: "Senior Software Engineer",
          bullets: ["Built member portal features."],
        },
        {
          company: "WSECU",
          title: "Software Engineer",
          bullets: ["Delivered mobile banking APIs."],
        },
        {
          company: "Robert Half",
          title: "Software Engineer",
          bullets: ["Supported enterprise client integrations."],
        },
      ],
    },
    ...overrides,
  };
}

test("parseTemplateDocx finds 6 slots in sample template", () => {
  const buffer = readFileSync(SAMPLE);
  const parsed = parseTemplateDocx(buffer, identity);
  assert.equal(parsed.slotCount, 6);
  assert.deepEqual(parsed.sectionsFound.sort(), ["experience", "skills", "summary"]);
  const summary = parsed.slots.filter((s) => s.section === "summary");
  const skills = parsed.slots.filter((s) => s.section === "skills");
  const exp = parsed.slots.filter((s) => s.section === "experience");
  assert.equal(summary.length, 1);
  assert.equal(skills.length, 1);
  assert.equal(exp.length, 4);
});

test("parseTemplateDocx extracts experience company hints", () => {
  const buffer = readFileSync(SAMPLE);
  const parsed = parseTemplateDocx(buffer, identity);
  const exp = parsed.slots.filter((s) => s.section === "experience");
  const hints = exp.map((s) => s.companyHint);
  assert.ok(hints.some((h) => fuzzyCompanyMatch(h, "McGrow Hill")));
  assert.ok(hints.some((h) => fuzzyCompanyMatch(h, "Accolade")));
  assert.ok(hints.some((h) => fuzzyCompanyMatch(h, "WSECU")));
  assert.ok(hints.some((h) => fuzzyCompanyMatch(h, "Robert Half")));
});

test("fillTemplateDocx replaces placeholders and clones bullets", () => {
  const buffer = readFileSync(SAMPLE);
  const parsed = parseTemplateDocx(buffer, identity);
  const { buffer: out } = fillTemplateDocx(buffer, parsed, baseSections());
  const text = out.toString("utf8");
  assert.ok(!text.includes("{}"), "filled doc should not contain raw {}");
  assert.ok(text.includes("Experienced engineer"));
  assert.ok(text.includes("TypeScript"));
  assert.ok(text.includes("Led platform migration"));
  assert.ok(text.includes("Improved API latency 40%"));
});

test("fillTemplateDocx preserves all four careers and education", () => {
  const buffer = readFileSync(SAMPLE);
  const parsed = parseTemplateDocx(buffer, identity);
  const { buffer: out } = fillTemplateDocx(buffer, parsed, baseSections());
  const text = out.toString("utf8");
  assert.ok(text.includes("McGrow Hill"));
  assert.ok(text.includes("Accolade"));
  assert.ok(text.includes("WSECU"));
  assert.ok(text.includes("Robert Half"));
  assert.ok(text.includes("Washington State University"));
  assert.ok(text.includes("Bachelor of Science"));
  assert.ok(text.includes("SKILLS") || text.includes("Skills"));
});

test("fillTemplateDocx grows paragraph count when bullets are cloned", () => {
  const buffer = readFileSync(SAMPLE);
  const xml = buffer.toString("utf8");
  const originalCount = extractParagraphs(xml.match(/<w:body[\s\S]*<\/w:body>/)?.[0] ?? xml).length;
  const parsed = parseTemplateDocx(buffer, identity);
  const { buffer: out } = fillTemplateDocx(buffer, parsed, baseSections());
  const outXml = out.toString("utf8");
  const body = outXml.match(/<w:body[\s\S]*<\/w:body>/)?.[0] ?? outXml;
  const filledCount = extractParagraphs(body).length;
  assert.ok(filledCount > originalCount, `expected more paragraphs (${filledCount} vs ${originalCount})`);
});

test("replacePlaceholderWithRichText converts **bold** markdown to w:b runs", () => {
  const para = '<w:p><w:r><w:rPr><w:sz w:val="21"/></w:rPr><w:t>{}</w:t></w:r></w:p>';
  const out = replacePlaceholderWithRichText(para, "Used **Qt** and **C++11** for migration.");
  assert.ok(out.includes("<w:b"));
  assert.ok(!out.includes("**"));
  assert.ok(out.includes("Qt"));
  assert.ok(out.includes("C++11"));
});

test("fuzzyCompanyMatch handles Inc suffix differences", () => {
  assert.ok(fuzzyCompanyMatch("Accolade, Inc", "Accolade Inc"));
  assert.ok(fuzzyCompanyMatch("McGrow Hill", "McGrow Hill"));
});
