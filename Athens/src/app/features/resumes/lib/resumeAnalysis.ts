import type { ResumeDocument, ResumeStackCatalog } from "../../../types/resume";

/** Normalization caps (count at cap => score 100) */
const CAPS = {
  languages: 5,
  frameworks: 6,
  databases: 4,
  cloudDevOps: 5,
  experienceRoles: 5,
  educationEntries: 3,
} as const;

export type RadarPoint = { dim: string; value: number };

export type ResumeStats = {
  totalSkills: number;
  strongestCategory: string;
  yearsExperience: number;
  educationCount: number;
  categoryCounts: Record<string, number>;
};

function clampScore(count: number, cap: number): number {
  return Math.min(100, Math.round((count / cap) * 100));
}

function flattenSkills(doc: ResumeDocument): string[] {
  const { skills } = doc;
  return [
    ...skills.languages,
    ...skills.frameworks,
    ...skills.databases,
    ...skills.cloudDevOps,
  ];
}

function normalizeSkill(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9+#.]/g, "");
}

function parseYearsFromExperiences(doc: ResumeDocument): number {
  let totalMonths = 0;
  for (const exp of doc.experiences) {
    const startYear = parseYear(exp.startDate);
    const endYear = exp.endDate.toLowerCase().includes("present")
      ? new Date().getFullYear()
      : parseYear(exp.endDate);
    if (startYear && endYear && endYear >= startYear) {
      totalMonths += (endYear - startYear) * 12 + 6;
    } else if (exp.bullets.length > 0) {
      totalMonths += 24;
    }
  }
  return Math.round((totalMonths / 12) * 10) / 10;
}

function parseYear(dateStr: string): number | null {
  const m = dateStr.match(/\b(19|20)\d{2}\b/);
  return m ? Number(m[0]) : null;
}

export function computeCompetencyRadar(doc: ResumeDocument): RadarPoint[] {
  const { skills, experiences, education } = doc;
  const expYears = parseYearsFromExperiences(doc);
  const expScore = Math.min(100, Math.round((expYears / 10) * 100));

  return [
    { dim: "Languages", value: clampScore(skills.languages.length, CAPS.languages) },
    { dim: "Frameworks", value: clampScore(skills.frameworks.length, CAPS.frameworks) },
    { dim: "Databases", value: clampScore(skills.databases.length, CAPS.databases) },
    { dim: "Cloud/DevOps", value: clampScore(skills.cloudDevOps.length, CAPS.cloudDevOps) },
    { dim: "Experience", value: expScore },
    { dim: "Education", value: clampScore(education.length, CAPS.educationEntries) },
  ];
}

export function computeStackCoverage(doc: ResumeDocument, catalog: ResumeStackCatalog): RadarPoint[] {
  const resumeSkills = new Set(flattenSkills(doc).map(normalizeSkill));
  if (!resumeSkills.size) return [];

  return Object.entries(catalog).map(([stackName, stackSkills]) => {
    const keys = Object.keys(stackSkills);
    if (!keys.length) return { dim: stackName, value: 0 };
    const matched = keys.filter((skill) => {
      const norm = normalizeSkill(skill);
      return [...resumeSkills].some(
        (rs) => rs.includes(norm) || norm.includes(rs) || rs === norm,
      );
    });
    const pct = Math.round((matched.length / keys.length) * 100);
    return { dim: shortenStackName(stackName), value: pct };
  });
}

function shortenStackName(name: string): string {
  if (name.length <= 18) return name;
  return name.replace(/\s*—\s*/, " · ").slice(0, 18) + "…";
}

export function computeResumeStats(doc: ResumeDocument): ResumeStats {
  const counts = {
    Languages: doc.skills.languages.length,
    Frameworks: doc.skills.frameworks.length,
    Databases: doc.skills.databases.length,
    "Cloud/DevOps": doc.skills.cloudDevOps.length,
  };
  const totalSkills = Object.values(counts).reduce((a, b) => a + b, 0);
  const strongestCategory =
    Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";

  return {
    totalSkills,
    strongestCategory,
    yearsExperience: parseYearsFromExperiences(doc),
    educationCount: doc.education.length,
    categoryCounts: counts,
  };
}

export function mergeRadarSeries(
  primary: RadarPoint[],
  compare?: RadarPoint[],
): { dim: string; primary: number; compare?: number }[] {
  const dims = new Set([...primary.map((p) => p.dim), ...(compare?.map((p) => p.dim) ?? [])]);
  const primaryMap = Object.fromEntries(primary.map((p) => [p.dim, p.value]));
  const compareMap = compare ? Object.fromEntries(compare.map((p) => [p.dim, p.value])) : {};

  return [...dims].map((dim) => ({
    dim,
    primary: primaryMap[dim] ?? 0,
    ...(compare ? { compare: compareMap[dim] ?? 0 } : {}),
  }));
}
