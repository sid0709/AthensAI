import { formatResumePeriodFromProfile } from "../../lib/formatResumeDate";
import type { CareerEntry, EducationEntry, Identity } from "../types";

export const storageKey = (applierName: string | null | undefined) => `resumeGeneratorConfig:${applierName ?? "default"}`;
export const applicationDraftStorageKey = (applierName: string | null | undefined) =>
  `resumeGeneratorApplicationDraft:${applierName ?? "default"}`;

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Match Settings CareerTimeline: most recent start date first. */
function timelineSortKey(row: Record<string, unknown>) {
  const y = parseInt(str(row.startYear), 10) || 0;
  const m = parseInt(str(row.startMonth), 10) || 0;
  return y * 12 + m;
}

function byNewestFirst(a: unknown, b: unknown) {
  return timelineSortKey((b ?? {}) as Record<string, unknown>) - timelineSortKey((a ?? {}) as Record<string, unknown>);
}

export function isValidJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

export function identityFromProfile(profile: Record<string, unknown>): Identity {
  const location = [str(profile.city).trim(), str(profile.state).trim()].filter(Boolean).join(", ");
  const fullName =
    str(profile.fullName).trim() ||
    [str(profile.firstName).trim(), str(profile.lastName).trim()].filter(Boolean).join(" ");
  const careersRaw = Array.isArray(profile.careers) ? profile.careers : [];
  const careers: CareerEntry[] = [...careersRaw]
    .sort(byNewestFirst)
    .map((c) => {
      const row = (c ?? {}) as Record<string, unknown>;
      const period = formatResumePeriodFromProfile(row);
      return { company: str(row.company), title: str(row.title), period, description: str(row.description).trim() };
    })
    .filter((c) => c.company || c.title);

  const eduRaw = Array.isArray(profile.educations)
    ? profile.educations
    : Array.isArray(profile.education)
      ? profile.education
      : [];
  const education: EducationEntry[] = [...eduRaw]
    .sort(byNewestFirst)
    .map((e) => {
      const row = (e ?? {}) as Record<string, unknown>;
      const period = formatResumePeriodFromProfile(row);
      const degree = [str(row.diploma) || str(row.degree), str(row.major) || str(row.field)].filter(Boolean).join(", ");
      return { school: str(row.school) || str(row.university), degree, period };
    })
    .filter((e) => e.school || e.degree);

  return {
    fullName,
    location,
    email: str(profile.email).trim(),
    phone: str(profile.phone).trim(),
    linkedin: str(profile.linkedin).trim(),
    careers,
    education,
  };
}
