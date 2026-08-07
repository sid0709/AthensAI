import type { JobDetailsCapsule } from '../mappers/job-metadata.mapper';
import { normalizeJobDetails } from '../mappers/job-metadata.mapper';

/**
 * Keep non-empty Extension/scrape-provided detail fields; fill gaps from AI.
 */
export function mergeJobDetails(
  existingRaw: unknown,
  aiDetails: JobDetailsCapsule,
): JobDetailsCapsule {
  const existing = normalizeJobDetails(existingRaw) ?? {};
  const next: JobDetailsCapsule = { ...existing };

  const keys: (keyof JobDetailsCapsule)[] = [
    'location',
    'time',
    'remote',
    'seniority',
    'salary',
  ];
  for (const key of keys) {
    const current = next[key];
    if (typeof current === 'string' && current.trim()) continue;
    const fromAi = aiDetails[key];
    if (typeof fromAi === 'string' && fromAi.trim()) {
      next[key] = fromAi.trim();
    }
  }
  return next;
}

export function asMetaRecord(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return { ...(raw as Record<string, unknown>) };
  }
  return {};
}
