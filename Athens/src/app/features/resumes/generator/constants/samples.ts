import type { EducationEntry, PreviewCareer } from "../types";

export const SAMPLE_SUMMARY =
  "Results-driven professional with a track record of shipping high-impact work. Adept at cross-functional collaboration and translating ambiguous goals into measurable outcomes.";
export const SAMPLE_SKILL_GROUPS: { category: string; items: string[] }[] = [
  { category: "Programming Languages", items: ["TypeScript", "JavaScript", "Python", "Go"] },
  { category: "Frameworks", items: ["React", "Node.js", "Next.js", "Express"] },
  { category: "Databases", items: ["PostgreSQL", "MongoDB", "Redis"] },
  { category: "Cloud & DevOps", items: ["AWS", "Docker", "CI/CD", "Terraform"] },
];
export const SAMPLE_BULLETS = [
  "Led a cross-functional team to ship a feature that lifted engagement 24%.",
  "Cut page load time 40% through targeted performance work.",
  "Mentored 3 engineers and introduced a code-review rubric.",
];

// Richer shape used only for the preview so company-first / single-line layouts
// have a location and bullets to render.
type PreviewCareer = { title: string; company: string; location: string; period: string; bullets: string[] };
export const SAMPLE_PREVIEW_CAREERS: PreviewCareer[] = [
  { title: "Senior Engineer", company: "Acme Corp", location: "Seattle, WA", period: "2022 – Present", bullets: SAMPLE_BULLETS },
  { title: "Software Engineer", company: "Globex", location: "Remote", period: "2019 – 2022", bullets: SAMPLE_BULLETS },
];
export const SAMPLE_EDUCATION: EducationEntry[] = [
  { school: "University of Washington", degree: "B.S. Computer Science", period: "2012 – 2016" },
];
