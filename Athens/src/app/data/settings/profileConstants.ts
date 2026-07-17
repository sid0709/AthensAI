export const GENDER_VALUES = ["prefer_not_say", "female", "male", "non_binary", "other"] as const;
export type Gender = (typeof GENDER_VALUES)[number];
export const GENDER_LABEL: Record<Gender, string> = {
  prefer_not_say: "Prefer not to say",
  female: "Female",
  male: "Male",
  non_binary: "Non-binary",
  other: "Other",
};

export const PRONOUN_VALUES = [
  "prefer_not_say",
  "she/her",
  "he/him",
  "they/them",
  "she/they",
  "he/they",
  "xe/xem",
  "ze/hir",
  "other",
] as const;
export type Pronouns = (typeof PRONOUN_VALUES)[number];
export const PRONOUN_LABEL: Record<Pronouns, string> = {
  prefer_not_say: "Prefer not to say",
  "she/her": "she/her",
  "he/him": "he/him",
  "they/them": "they/them",
  "she/they": "she/they",
  "he/they": "he/they",
  "xe/xem": "xe/xem",
  "ze/hir": "ze/hir",
  other: "Other",
};

export const ORIENTATION_VALUES = [
  "prefer_not_say",
  "heterosexual",
  "gay",
  "lesbian",
  "bisexual",
  "pansexual",
  "asexual",
  "other",
] as const;
export type SexualOrientation = (typeof ORIENTATION_VALUES)[number];
export const ORIENTATION_LABEL: Record<SexualOrientation, string> = {
  prefer_not_say: "Prefer not to say",
  heterosexual: "Heterosexual",
  gay: "Gay",
  lesbian: "Lesbian",
  bisexual: "Bisexual",
  pansexual: "Pansexual",
  asexual: "Asexual",
  other: "Other",
};

export const YES_NO_DECLINE_VALUES = ["prefer_not_say", "yes", "no"] as const;
export type YesNoDecline = (typeof YES_NO_DECLINE_VALUES)[number];
export const YES_NO_DECLINE_LABEL: Record<YesNoDecline, string> = {
  prefer_not_say: "Prefer not to say",
  yes: "Yes",
  no: "No",
};

export const VETERAN_VALUES = ["prefer_not_say", "protected", "not_protected"] as const;
export type VeteranStatus = (typeof VETERAN_VALUES)[number];
export const VETERAN_LABEL: Record<VeteranStatus, string> = {
  prefer_not_say: "Prefer not to say",
  protected: "I am a protected veteran",
  not_protected: "I am not a protected veteran",
};

export const RACE_VALUES = [
  "prefer_not_say",
  "american_indian_alaska_native",
  "asian",
  "black",
  "native_hawaiian",
  "white",
  "two_or_more",
  "other",
] as const;
export type RaceEthnicity = (typeof RACE_VALUES)[number];
export const RACE_LABEL: Record<RaceEthnicity, string> = {
  prefer_not_say: "Prefer not to say",
  american_indian_alaska_native: "American Indian or Alaska Native",
  asian: "Asian",
  black: "Black or African American",
  native_hawaiian: "Native Hawaiian or Other Pacific Islander",
  white: "White",
  two_or_more: "Two or More Races",
  other: "Other",
};

export const IMMIGRATION_STATUS_VALUES = [
  "prefer_not_say",
  "us_citizen",
  "permanent_resident",
  "work_visa",
  "requires_sponsorship",
] as const;
export type ImmigrationStatus = (typeof IMMIGRATION_STATUS_VALUES)[number];
export const IMMIGRATION_STATUS_LABEL: Record<ImmigrationStatus, string> = {
  prefer_not_say: "Prefer not to say",
  us_citizen: "U.S. Citizen",
  permanent_resident: "U.S. Permanent Resident (Green Card)",
  work_visa: "Work visa (H-1B, OPT, etc.)",
  requires_sponsorship: "Will require visa sponsorship now or in the future",
};

export const COUNTRY_OPTIONS = [
  { value: "", label: "— Select country —" },
  { value: "United States", label: "United States" },
  { value: "Canada", label: "Canada" },
  { value: "United Kingdom", label: "United Kingdom" },
  { value: "Australia", label: "Australia" },
  { value: "Germany", label: "Germany" },
  { value: "France", label: "France" },
  { value: "India", label: "India" },
  { value: "Mexico", label: "Mexico" },
  { value: "Brazil", label: "Brazil" },
  { value: "Japan", label: "Japan" },
  { value: "China", label: "China" },
  { value: "South Korea", label: "South Korea" },
  { value: "Netherlands", label: "Netherlands" },
  { value: "Singapore", label: "Singapore" },
  { value: "Other", label: "Other" },
] as const;

export const MONTH_OPTIONS = [
  { value: "", label: "—" },
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => ({ value: String(n), label: String(n) })),
];

export const CAREER_END_MONTH_OPTIONS = [...MONTH_OPTIONS, { value: "present", label: "Present" }];

export function pickEnum<T extends string>(raw: unknown, values: readonly T[], fallback: T): T {
  const s = String(raw ?? "").trim();
  return values.includes(s as T) ? (s as T) : fallback;
}

export function enumOptions<T extends string>(values: readonly T[], labels: Record<T, string>) {
  return values.map((v) => ({ value: v, label: labels[v] }));
}
