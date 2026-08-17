import type { UserProfile } from "../../../data/settings/profile";
import type { GeneratorIdentity } from "../../../types/resume";
import { formatResumePeriodFromProfile } from "./formatResumeDate";

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Match Settings CareerTimeline: most recent start date first. */
function timelineSortKey(row: { startYear?: string; startMonth?: string }) {
  const y = parseInt(str(row.startYear), 10) || 0;
  const m = parseInt(str(row.startMonth), 10) || 0;
  return y * 12 + m;
}

export function identityFromProfile(profile: UserProfile | Record<string, unknown>): GeneratorIdentity {
  const p = profile as UserProfile;
  const location = [str(p.city).trim(), str(p.state).trim()].filter(Boolean).join(", ");
  const careers = [...(Array.isArray(p.careers) ? p.careers : [])]
    .sort((a, b) => timelineSortKey(b) - timelineSortKey(a))
    .map((c) => ({
      company: str(c.company),
      title: str(c.title),
      period: formatResumePeriodFromProfile(c),
    }))
    .filter((c) => c.company || c.title);

  const education = [...(Array.isArray(p.education) ? p.education : [])]
    .sort((a, b) => timelineSortKey(b) - timelineSortKey(a))
    .map((e) => ({
      school: str(e.school),
      degree: str(e.diploma),
      period: formatResumePeriodFromProfile(e),
    }))
    .filter((e) => e.school || e.degree);

  return {
    fullName: str(p.fullName).trim() || `${str(p.firstName)} ${str(p.lastName)}`.trim(),
    location,
    email: str(p.email).trim(),
    phone: str(p.phone).trim(),
    linkedin: str(p.linkedin).trim(),
    careers,
    education,
  };
}

export function generatorStorageKey(applierName: string | null | undefined): string {
  return `resumeGeneratorConfig:${applierName ?? "default"}`;
}

export function isValidJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}
