import type { GeneratorIdentity, ResumeDocument, ResumeEducation, ResumeExperience } from "../../../types/resume";

type GeneratedSections = {
  summary?: { summary?: string } | string;
  skills?: { skills?: { category: string; items: string[] }[] };
  experience?: { experiences?: { company?: string; title?: string; period?: string; bullets?: string[] }[] };
  education?: unknown;
};

function parsePeriod(period: string): { startDate: string; endDate: string } {
  const parts = period.split(/[–\-—]/).map((p) => p.trim());
  return { startDate: parts[0] || "", endDate: parts[1] || "Present" };
}

export function sectionsToDocument(
  sections: GeneratedSections,
  identity: GeneratorIdentity,
  base?: ResumeDocument,
): ResumeDocument {
  const doc = base ? structuredClone(base) : {
    id: `doc-${Date.now()}`,
    identity: {
      fullName: identity.fullName,
      location: identity.location,
      email: identity.email,
      phone: identity.phone,
      linkedin: identity.linkedin,
    },
    summary: "",
    experiences: [],
    skills: { languages: [], frameworks: [], databases: [], cloudDevOps: [] },
    education: [],
  };

  const summaryRaw = sections.summary;
  if (typeof summaryRaw === "string") {
    doc.summary = summaryRaw;
  } else if (summaryRaw && typeof summaryRaw === "object" && "summary" in summaryRaw) {
    doc.summary = String(summaryRaw.summary ?? "");
  }

  const skillGroups = sections.skills?.skills;
  if (Array.isArray(skillGroups)) {
    const all: string[] = [];
    for (const g of skillGroups) {
      if (Array.isArray(g.items)) all.push(...g.items);
    }
    doc.skills = {
      languages: all.slice(0, Math.ceil(all.length / 4)),
      frameworks: all.slice(Math.ceil(all.length / 4), Math.ceil(all.length / 2)),
      databases: all.slice(Math.ceil(all.length / 2), Math.ceil((3 * all.length) / 4)),
      cloudDevOps: all.slice(Math.ceil((3 * all.length) / 4)),
    };
  }

  const exps = sections.experience?.experiences;
  if (Array.isArray(exps)) {
    doc.experiences = exps.map((e, i) => {
      const { startDate, endDate } = parsePeriod(String(e.period ?? ""));
      return {
        id: `exp-${i}`,
        company: String(e.company ?? ""),
        role: String(e.title ?? ""),
        location: "",
        startDate,
        endDate,
        bullets: Array.isArray(e.bullets) ? e.bullets.map(String) : [],
      } satisfies ResumeExperience;
    });
  } else if (identity.careers.length) {
    doc.experiences = identity.careers.map((c, i) => {
      const { startDate, endDate } = parsePeriod(c.period);
      return {
        id: `exp-${i}`,
        company: c.company,
        role: c.title,
        location: "",
        startDate,
        endDate,
        bullets: [],
      };
    });
  }

  if (identity.education.length) {
    doc.education = identity.education.map((e, i) => {
      const { endDate } = parsePeriod(e.period);
      return {
        id: `edu-${i}`,
        school: e.school,
        degree: e.degree,
        location: "",
        graduationDate: endDate,
      } satisfies ResumeEducation;
    });
  }

  return doc;
}
