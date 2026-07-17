import {
  type Gender,
  type ImmigrationStatus,
  type Pronouns,
  type RaceEthnicity,
  type SexualOrientation,
  type VeteranStatus,
  type YesNoDecline,
  GENDER_VALUES,
  IMMIGRATION_STATUS_VALUES,
  ORIENTATION_VALUES,
  PRONOUN_VALUES,
  RACE_VALUES,
  VETERAN_VALUES,
  YES_NO_DECLINE_VALUES,
  pickEnum,
} from "./profileConstants";

export type EducationEntry = {
  school: string;
  diploma: string;
  startMonth: string;
  startYear: string;
  endMonth: string;
  endYear: string;
};

export type CareerEntry = {
  company: string;
  title: string;
  description: string;
  startMonth: string;
  startYear: string;
  endMonth: string;
  endYear: string;
  endPresent: boolean;
};

export type UserProfile = {
  fullName: string;
  firstName: string;
  lastName: string;
  age: string;
  address: string;
  city: string;
  state: string;
  country: string;
  zipCode: string;
  desiredSalary: string;
  gender: Gender;
  pronouns: Pronouns;
  sexualOrientation: SexualOrientation;
  email: string;
  gmailAppPassword: string;
  openaiApiKey: string;
  deepseekApiKey: string;
  /** Default model used by all AI features (empty until set). */
  defaultProvider: string;
  defaultModel: string;
  defaultPassword: string;
  phone: string;
  linkedin: string;
  github: string;
  portfolioUrl: string;
  education: EducationEntry[];
  careers: CareerEntry[];
  demographicHispanic: YesNoDecline;
  demographicRaceEthnicity: RaceEthnicity;
  demographicDisability: YesNoDecline;
  demographicMilitaryStatus: VeteranStatus;
  sponsorship: YesNoDecline;
  immigrationStatus: ImmigrationStatus;
  resumeFolderUrl: string;
  /** Server timestamps for identity ↔ résumé sync (optional on client). */
  updatedAt?: string | null;
  resumeUpdatedAt?: string | null;
};

export const emptyEducation = (): EducationEntry => ({
  school: "",
  diploma: "",
  startMonth: "",
  startYear: "",
  endMonth: "",
  endYear: "",
});

export const emptyCareer = (): CareerEntry => ({
  company: "",
  title: "",
  description: "",
  startMonth: "",
  startYear: "",
  endMonth: "",
  endYear: "",
  endPresent: false,
});

export const emptyProfile = (): UserProfile => ({
  fullName: "",
  firstName: "",
  lastName: "",
  age: "",
  address: "",
  city: "",
  state: "",
  country: "",
  zipCode: "",
  desiredSalary: "",
  gender: "prefer_not_say",
  pronouns: "prefer_not_say",
  sexualOrientation: "prefer_not_say",
  email: "",
  gmailAppPassword: "",
  openaiApiKey: "",
  deepseekApiKey: "",
  defaultProvider: "",
  defaultModel: "",
  defaultPassword: "",
  phone: "",
  linkedin: "",
  github: "",
  portfolioUrl: "",
  education: [emptyEducation()],
  careers: [emptyCareer()],
  demographicHispanic: "prefer_not_say",
  demographicRaceEthnicity: "prefer_not_say",
  demographicDisability: "prefer_not_say",
  demographicMilitaryStatus: "prefer_not_say",
  sponsorship: "prefer_not_say",
  immigrationStatus: "prefer_not_say",
  resumeFolderUrl: "",
});

/** @deprecated Use emptyProfile() — kept for resume bridge fallback */
export const DEFAULT_PROFILE = emptyProfile();

export function mapProfileFromApi(raw: Record<string, unknown> | undefined): UserProfile {
  if (!raw || typeof raw !== "object") return emptyProfile();

  const eduRaw = raw.education;
  const education: EducationEntry[] = Array.isArray(eduRaw)
    ? eduRaw.map((e) => {
        const x = e && typeof e === "object" ? (e as Record<string, unknown>) : {};
        return {
          school: String(x.school ?? ""),
          diploma: String(x.diploma ?? ""),
          startMonth: String(x.startMonth ?? ""),
          startYear: String(x.startYear ?? ""),
          endMonth: String(x.endMonth ?? ""),
          endYear: String(x.endYear ?? ""),
        };
      })
    : [];

  const carRaw = raw.careers;
  const careers: CareerEntry[] = Array.isArray(carRaw)
    ? carRaw.map((c) => {
        const x = c && typeof c === "object" ? (c as Record<string, unknown>) : {};
        const endPresent = !!x.endPresent || String(x.endMonth ?? "").trim().toLowerCase() === "present";
        return {
          company: String(x.company ?? ""),
          title: String(x.title ?? ""),
          description: String(x.description ?? ""),
          startMonth: String(x.startMonth ?? ""),
          startYear: String(x.startYear ?? ""),
          endPresent,
          endMonth: endPresent ? "" : String(x.endMonth ?? ""),
          endYear: endPresent ? "" : String(x.endYear ?? ""),
        };
      })
    : [];

  const legacyCareer = String(raw.companyCareer ?? "").trim();
  const mergedCareers =
    careers.length > 0
      ? careers
      : legacyCareer
        ? [{ ...emptyCareer(), company: legacyCareer.split("·")[0]?.trim() || legacyCareer, title: legacyCareer.split("·")[1]?.trim() || "" }]
        : [emptyCareer()];

  return {
    fullName: String(raw.fullName ?? ""),
    firstName: String(raw.firstName ?? ""),
    lastName: String(raw.lastName ?? ""),
    age: String(raw.age ?? ""),
    address: String(raw.address ?? ""),
    city: String(raw.city ?? ""),
    state: String(raw.state ?? ""),
    country: String(raw.country ?? ""),
    zipCode: String(raw.zipCode ?? ""),
    desiredSalary: String(raw.desiredSalary ?? ""),
    gender: pickEnum(raw.gender, GENDER_VALUES, "prefer_not_say"),
    pronouns: pickEnum(raw.pronouns, PRONOUN_VALUES, "prefer_not_say"),
    sexualOrientation: pickEnum(raw.sexualOrientation, ORIENTATION_VALUES, "prefer_not_say"),
    email: String(raw.email ?? ""),
    gmailAppPassword: String(raw.gmailAppPassword ?? ""),
    openaiApiKey: String(raw.openaiApiKey ?? ""),
    deepseekApiKey: String(raw.deepseekApiKey ?? ""),
    defaultProvider: raw.defaultProvider === "openai" || raw.defaultProvider === "deepseek" ? raw.defaultProvider : "",
    defaultModel: String(raw.defaultModel ?? ""),
    defaultPassword: String(raw.defaultPassword ?? ""),
    phone: String(raw.phone ?? ""),
    linkedin: String(raw.linkedin ?? ""),
    github: String(raw.github ?? ""),
    portfolioUrl: String(raw.portfolioUrl ?? ""),
    education: education.length ? education : [emptyEducation()],
    careers: mergedCareers.length ? mergedCareers : [emptyCareer()],
    demographicHispanic: pickEnum(raw.demographicHispanic, YES_NO_DECLINE_VALUES, "prefer_not_say"),
    demographicRaceEthnicity: pickEnum(raw.demographicRaceEthnicity, RACE_VALUES, "prefer_not_say"),
    demographicDisability: pickEnum(raw.demographicDisability, YES_NO_DECLINE_VALUES, "prefer_not_say"),
    demographicMilitaryStatus: pickEnum(raw.demographicMilitaryStatus, VETERAN_VALUES, "prefer_not_say"),
    sponsorship: pickEnum(raw.sponsorship, YES_NO_DECLINE_VALUES, "prefer_not_say"),
    immigrationStatus: pickEnum(raw.immigrationStatus, IMMIGRATION_STATUS_VALUES, "prefer_not_say"),
    resumeFolderUrl: String(raw.resumeFolderUrl ?? ""),
    updatedAt: raw.updatedAt ? String(raw.updatedAt) : null,
    resumeUpdatedAt: raw.resumeUpdatedAt ? String(raw.resumeUpdatedAt) : null,
  };
}

export function buildProfileSavePayload(profile: UserProfile, applierName: string, vendorAllowed: boolean) {
  return {
    applierName,
    vendorAllowed,
    ...profile,
    education: profile.education.filter((e) => e.school.trim() || e.diploma.trim() || e.startYear || e.endYear),
    careers: profile.careers.filter((c) => {
      const hasWho = !!(c.company.trim() || c.title.trim());
      const hasWhen = !!(c.startYear || c.endYear || c.endPresent);
      return hasWho && hasWhen;
    }),
  };
}
