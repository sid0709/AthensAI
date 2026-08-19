/** Bound Worker-pool job id from Oak analyze `page.job.id`. */
export function jobIdFromPage(page: unknown): string | null {
  if (!page || typeof page !== 'object' || Array.isArray(page)) return null;
  const job = (page as { job?: unknown }).job;
  if (!job || typeof job !== 'object' || Array.isArray(job)) return null;
  const idRaw = (job as { id?: unknown }).id;
  const id = typeof idRaw === 'string' ? idRaw.trim() : '';
  return id || null;
}

/** Overwrite client resume flag with the server-resolved value. */
export function withRecommendedResumeAvailable(
  page: unknown,
  available: boolean,
): Record<string, unknown> {
  const base =
    page && typeof page === 'object' && !Array.isArray(page)
      ? { ...(page as Record<string, unknown>) }
      : {};
  return { ...base, recommendedResumeAvailable: available };
}
