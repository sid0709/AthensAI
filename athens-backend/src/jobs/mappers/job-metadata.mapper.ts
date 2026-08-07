/**
 * Canonical job metadata capsule (stored on Job / TempJob.metadata).
 * details: location (was position), salary (was money); companyTags and date removed.
 */
export type JobDetailsCapsule = {
  location?: string;
  time?: string;
  remote?: string;
  seniority?: string;
  salary?: string;
};

export type JobMetadataCapsule = {
  legacyId?: string;
  companyLogo?: string;
  details?: JobDetailsCapsule;
  titleReview?: unknown;
};

type RawDetails = Record<string, unknown>;

function asObject(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

function pickString(details: RawDetails, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = details[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

/** Normalize legacy or current details → { location, time, remote, seniority, salary }. */
export function normalizeJobDetails(raw: unknown): JobDetailsCapsule | undefined {
  const details = asObject(raw);
  if (!details) return undefined;

  const location = pickString(details, 'location', 'position');
  const time = pickString(details, 'time');
  const remote = pickString(details, 'remote');
  const seniority = pickString(details, 'seniority');
  const salary = pickString(details, 'salary', 'money');

  const next: JobDetailsCapsule = {};
  if (location) next.location = location;
  if (time) next.time = time;
  if (remote) next.remote = remote;
  if (seniority) next.seniority = seniority;
  if (salary) next.salary = salary;
  return Object.keys(next).length ? next : undefined;
}

/** Drop companyTags / details.date; rename position→location, money→salary. */
export function normalizeJobMetadata(raw: unknown): JobMetadataCapsule | undefined {
  const meta = asObject(raw);
  if (!meta) return undefined;

  const next: JobMetadataCapsule = {};
  if (typeof meta.legacyId === 'string' && meta.legacyId.trim()) {
    next.legacyId = meta.legacyId.trim();
  }
  if (typeof meta.companyLogo === 'string' && meta.companyLogo.trim()) {
    next.companyLogo = meta.companyLogo.trim();
  }
  const details = normalizeJobDetails(meta.details);
  if (details) next.details = details;
  if (meta.titleReview != null) next.titleReview = meta.titleReview;
  return Object.keys(next).length ? next : undefined;
}
