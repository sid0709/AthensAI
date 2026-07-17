import type { GeneratedContent } from "../types";

export function normalizeGenerated(sections: Record<string, unknown> | null | undefined): GeneratedContent {
  const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
  const summarySec = obj(sections?.["summary"]);
  const skillsSec = obj(sections?.["skills"]);
  const expSec = obj(sections?.["experience"]);

  const summary = typeof summarySec.summary === "string" ? summarySec.summary : null;

  const skillsArr = Array.isArray(skillsSec.skills) ? skillsSec.skills : null;
  const skills = skillsArr
    ? skillsArr
        .map((g) => {
          const row = obj(g);
          const items = Array.isArray(row.items) ? row.items.map(String) : [];
          return { category: String(row.category ?? ""), items };
        })
        .filter((g) => g.category || g.items.length)
    : null;

  const expArr = Array.isArray(expSec.experiences) ? expSec.experiences : Array.isArray(expSec.experience) ? expSec.experience : null;
  const experience = expArr
    ? expArr.map((e) => {
        const row = obj(e);
        return {
          title: String(row.title ?? row.role ?? ""),
          company: String(row.company ?? ""),
          location: String(row.location ?? ""),
          period: String(row.period ?? row.dates ?? ""),
          bullets: Array.isArray(row.bullets) ? row.bullets.map(String) : [],
        };
      })
    : null;

  return { summary, skills: skills && skills.length ? skills : null, experience: experience && experience.length ? experience : null };
}

// Merge ONE final step's output into the running generated content, so a section
// can update in the preview the instant its final step completes.
export function mergeGeneratedSection(prev: GeneratedContent | null, purpose: string, output: unknown): GeneratedContent {
  const base = prev ?? { summary: null, skills: null, experience: null };
  const one = normalizeGenerated({ [purpose]: output });
  if (purpose === "summary") return { ...base, summary: one.summary ?? base.summary };
  if (purpose === "skills") return { ...base, skills: one.skills ?? base.skills };
  if (purpose === "experience") return { ...base, experience: one.experience ?? base.experience };
  return base;
}
