/** NFKD slug for Firebase folder segment (profile name). Max 80 chars. */
export function storageSlug(raw: string): string {
  const base = String(raw ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return base || 'profile';
}
