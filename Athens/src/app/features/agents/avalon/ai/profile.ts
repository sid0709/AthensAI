export interface AutoBidProfile {
  fullName?: string;
  firstName?: string;
  lastName?: string;
  age?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  zipCode?: string;
  desiredSalary?: string;
  gender?: string;
  pronouns?: string;
  sexualOrientation?: string;
  email?: string;
  phone?: string;
  linkedin?: string;
  github?: string;
  portfolioUrl?: string;
  education?: Array<{
    school?: string;
    diploma?: string;
    startMonth?: string;
    startYear?: string;
    endMonth?: string;
    endYear?: string;
  }>;
  careers?: Array<{
    company?: string;
    title?: string;
    description?: string;
    startMonth?: string;
    startYear?: string;
    endPresent?: boolean;
    endMonth?: string;
    endYear?: string;
  }>;
  prefSponsorship?: boolean;
  prefVeteranFriendly?: boolean;
  prefDisabilityFriendly?: boolean;
  demographicHispanic?: string;
  demographicRaceEthnicity?: string;
  demographicDisability?: string;
  demographicMilitaryStatus?: string;
  sponsorship?: string;
  immigrationStatus?: string;
  resumeFolderUrl?: string;
}

export interface ProfileDocument {
  name?: string;
  autoBidProfile?: AutoBidProfile;
}

const SENSITIVE_KEYS = new Set(["password", "defaultPassword"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripSensitive(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(key)) continue;
    out[key] = value;
  }
  return out;
}

export function extractAutoBidProfile(raw: string): AutoBidProfile | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed) as ProfileDocument | AutoBidProfile;
    if (isRecord(parsed) && "autoBidProfile" in parsed && isRecord(parsed.autoBidProfile)) {
      return stripSensitive(parsed.autoBidProfile) as AutoBidProfile;
    }
    if (isRecord(parsed) && ("fullName" in parsed || "email" in parsed || "firstName" in parsed)) {
      return stripSensitive(parsed) as AutoBidProfile;
    }
  } catch {
    return null;
  }

  return null;
}

export function formatProfileForPrompt(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  const profile = extractAutoBidProfile(trimmed);
  if (profile) {
    return JSON.stringify({ autoBidProfile: profile }, null, 2);
  }

  return trimmed;
}

export function formatApplierProfile(autoBidProfile: Record<string, unknown> | undefined): string {
  if (!autoBidProfile || !Object.keys(autoBidProfile).length) return "";
  return JSON.stringify({ autoBidProfile: stripSensitive(autoBidProfile) }, null, 2);
}

export async function readProfileFile(file: File): Promise<string> {
  const text = await file.text();
  return formatProfileForPrompt(text);
}
